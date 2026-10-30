import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.request import urlopen
from zipfile import BadZipFile

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from directory.postcodes import SOURCE, import_archive
from directory.postal_scope import EEA_UK_COUNTRIES, PREFIX_COUNTRIES
from directory.models import PostalDataset


class Command(BaseCommand):
    help = "Import local GeoNames postcode/place suggestions for the EEA and UK."

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group()
        group.add_argument("--country", help="Import one two-letter country code.")
        group.add_argument("--scope", choices=["eea-uk"], help="All 30 EEA countries plus the UK; the default scope.")
        parser.add_argument("--file", type=Path, help="An already downloaded ZIP; requires --country.")
        parser.add_argument("--directory", type=Path, help="Import cached country ZIPs without downloading.")
        parser.add_argument("--all-countries", action="store_true", help="Read the global GeoNames postal ZIP but import only --country.")

    def handle(self, *args, **options):
        country = (options["country"] or "").strip().upper()
        if country and not re.fullmatch(r"[A-Z]{2}", country):
            raise CommandError("Use a two-letter country code such as HU.")
        if options["file"] and not country:
            raise CommandError("--file requires --country.")
        if options["all_countries"] and not country:
            raise CommandError("--all-countries requires --country; only that country's rows are imported.")
        countries = [country] if country else EEA_UK_COUNTRIES
        cache = options["directory"] or settings.BASE_DIR.parent / ".local/geonames"
        cache.mkdir(parents=True, exist_ok=True)
        report = {}
        if not options["file"] and not options["directory"]:
            try:
                with urlopen("https://download.geonames.org/export/zip/readme.txt", timeout=30) as response:
                    (cache / "readme.txt").write_bytes(response.read(1024 * 1024))
            except OSError as error:
                raise CommandError(f"Cannot download GeoNames source/attribution notes: {error}") from error
        for code in countries:
            try:
                existing = PostalDataset.objects.filter(pk=code, imported_at__isnull=False).first()
                if existing and existing.provider_name != "GeoNames":
                    report[code] = {"status": "retained", "source": existing.provider_name, "rows": existing.row_count}
                    self.stdout.write(f"{code}: retained existing {existing.provider_name} data.")
                    continue
                if options["file"] or options["directory"]:
                    content = (options["file"] or cache / f"{code}.zip").read_bytes()
                else:
                    filename = "allCountries" if options["all_countries"] else code
                    limit = (50 if options["all_countries"] else 20) * 1024 * 1024
                    with urlopen(SOURCE.format(country=filename), timeout=30) as response:
                        content = response.read(limit + 1)
                    if len(content) > limit:
                        raise ValueError("The downloaded ZIP exceeds the import size limit.")
                    (cache / f"{filename}.zip").write_bytes(content)
                dataset = import_archive(code, content)
                report[code] = {"status": "imported", "rows": dataset.row_count, "precision": "prefix" if code in PREFIX_COUNTRIES else "postcode"}
                self.stdout.write(self.style.SUCCESS(f"{code}: imported {dataset.row_count} postcode/place rows."))
            except HTTPError as error:
                report[code] = {"status": "unavailable" if error.code == 404 else "failed", "error": str(error)}
                self.stdout.write(self.style.WARNING(f"{code}: {report[code]['status']} ({error})."))
            except (OSError, ValueError, BadZipFile, KeyError) as error:
                report[code] = {"status": "failed", "error": str(error)}
                self.stdout.write(self.style.WARNING(f"{code}: failed ({error})."))
            self.stdout.flush()
        (cache / "import-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        imported = sum(item["status"] in {"imported", "retained"} for item in report.values())
        self.stdout.write(f"Imported {imported}/{len(countries)} requested country datasets. Coverage details: {cache / 'import-report.json'}")
        incomplete = [code for code, item in report.items() if item["status"] not in {"imported", "retained"}]
        if incomplete:
            raise CommandError(f"Datasets not imported: {', '.join(incomplete)}. Imported countries were retained; these gaps require follow-up.")
