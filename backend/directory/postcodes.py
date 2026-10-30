"""Local postcode suggestions; chosen values are copied onto stops."""
import hashlib
import io
import unicodedata
import zipfile
from itertools import islice

from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from directory.countries import country_lookup
from directory.models import PostalDataset, PostalPlace
from directory.postal_scope import PREFIX_COUNTRIES, UK_REGIONS

SOURCE = "https://download.geonames.org/export/zip/{country}.zip"


def folded(value):
    return "".join(char for char in unicodedata.normalize("NFKD", value) if not unicodedata.combining(char)).casefold()


def postcode_key(value):
    return "".join(char for char in value.casefold() if char.isalnum())


def import_archive(country, content):
    # Parse and validate before replacing any previously imported reference data.
    rows = {}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        global_dump = f"{country}.txt" not in archive.namelist() and "allCountries.txt" in archive.namelist()
        member = archive.getinfo("allCountries.txt" if global_dump else f"{country}.txt")
        if member.file_size > (500 if global_dump else 50) * 1024 * 1024:
            raise ValueError("The postcode text exceeds the import size limit.")
        with archive.open(member) as source:
            for number, line in enumerate(io.TextIOWrapper(source, encoding="utf-8-sig"), 1):
                if not line.strip():
                    continue
                fields = line.rstrip("\r\n").split("\t")
                if global_dump and fields[0] != country:
                    continue
                if len(fields) != 12 or fields[0] != country:
                    raise ValueError(f"Invalid GeoNames country or column count at row {number}.")
                postcode, place, admin = (fields[index].strip() for index in [1, 2, 3])
                if not postcode or len(postcode) > 20 or len(place) > 180 or len(admin) > 100:
                    raise ValueError(f"Invalid postcode/place at row {number}.")
                rows[(postcode, place, admin)] = folded(place)
    if not rows:
        raise ValueError("The source has no postcode/place rows; the existing dataset was retained.")
    return store_places(country, rows, hashlib.sha256(content).hexdigest(), SOURCE.format(country="allCountries" if global_dump else country), postcode_precision="prefix" if country in PREFIX_COUNTRIES else "postcode")


def store_places(country, rows, checksum, source_url, provider_name="GeoNames", provider_url="https://www.geonames.org/", license_name="CC BY 4.0", coverage_note="", postcode_precision="postcode"):
    if not rows:
        raise ValueError("No valid postcode/place records; the existing dataset was retained.")
    with transaction.atomic():
        dataset, _ = PostalDataset.objects.get_or_create(country_code=country)
        dataset = PostalDataset.objects.select_for_update().get(pk=dataset.pk)
        dataset.places.all().delete()
        records = (PostalPlace(dataset=dataset, postal_code=key[0], place_name=key[1], admin_name=key[2], search_name=value,
                               search_postcode=postcode_key(key[0])) for key, value in rows.items())
        while batch := list(islice(records, 1000)):
            PostalPlace.objects.bulk_create(batch, batch_size=1000)
        dataset.source_url = source_url
        dataset.checksum = checksum
        dataset.provider_name = provider_name
        dataset.provider_url = provider_url
        dataset.license_name = license_name
        dataset.coverage_note = coverage_note
        dataset.postcode_precision = postcode_precision
        dataset.row_count = len(rows)
        dataset.imported_at = timezone.now()
        dataset.save()
    return dataset


@api_view(["GET"])
def postcode_search(request):
    value = request.query_params.get("country", "").strip()
    country = country_lookup().get(value.casefold())
    code = (country["code"] if country else value.upper()).split("-")[0]
    selected_code = country["code"] if country else value.upper()
    dataset = PostalDataset.objects.filter(pk=code, imported_at__isnull=False).first()
    term = request.query_params.get("q", "").strip()[:180]
    results = []
    if dataset and len(term) >= 2:
        query = Q(pk__in=[])
        if postcode_key(term):
            query |= Q(search_postcode__startswith=postcode_key(term))
        if folded(term).strip():
            words = Q()
            for word in folded(term).split():
                match = Q(search_name__contains=word)
                if postcode_key(word):
                    match |= Q(search_postcode__startswith=postcode_key(word))
                words &= match
            query |= words
        matches = dataset.places.filter(query)
        if selected_code in UK_REGIONS:
            matches = matches.filter(admin_name__iexact=UK_REGIONS[selected_code])
        matches = matches.annotate(exact=Case(When(search_postcode=postcode_key(term), then=Value(0)), default=Value(1), output_field=IntegerField())).order_by("exact", "postal_code", "place_name", "pk")
        results = list(matches.values("id", "postal_code", "place_name", "admin_name")[:20])
    return Response({"country": code, "available": bool(dataset), "results": results,
                     "postcode_precision": dataset.postcode_precision if dataset else "postcode",
                     "coverage_note": dataset.coverage_note if dataset and dataset.coverage_note else "GeoNames supplies postcode prefixes here; complete the full postcode manually when known." if dataset and dataset.postcode_precision == "prefix" else "",
                     "imported_at": dataset.imported_at if dataset else None,
                     "source": dataset.provider_name if dataset else "GeoNames", "source_url": dataset.provider_url if dataset else "https://www.geonames.org/", "license": dataset.license_name if dataset else "CC BY 4.0"})
