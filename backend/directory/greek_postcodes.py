"""Greek local-area/postcode reference from the official GISCO CSV distribution."""
import csv
import hashlib
from pathlib import Path

from directory.postcodes import folded, store_places

SOURCE = "https://gisco-services.ec.europa.eu/distribution/v2/pcode/csv/PCODE_PT_2025_4326.csv"
PROVIDER = "https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units/postal-codes"
NOTICE = "© European Union - GISCO, 2024, postal code point dataset, Licence CC-BY-SA 4.0."


def import_greek_csv(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as raw:
        for block in iter(lambda: raw.read(1024 * 1024), b""):
            digest.update(block)
    rows = {}
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        sample = source.read(8192)
        source.seek(0)
        reader = csv.DictReader(source, dialect=csv.Sniffer().sniff(sample, delimiters=",;\t"))
        headers = reader.fieldnames or []
        code_field = next((field for field in ["POSTCODE", "POSTAL_CODE", "PCODE"] if field in headers), None)
        if "CNTR_ID" not in headers or not code_field or "LAU_NAME" not in headers:
            raise ValueError(f"Unexpected GISCO columns: {headers}")
        for row in reader:
            if row["CNTR_ID"] not in {"EL", "GR"}:
                continue
            postcode = row[code_field].strip().replace(" ", "")
            place = (row.get("LAU_NAME") or "").strip()
            if len(postcode) != 5 or not postcode.isascii() or not postcode.isdigit() or len(place) > 180:
                raise ValueError(f"Invalid Greek postcode/local-area record: {postcode!r}")
            rows[(postcode, place, "")] = folded(place)
    return store_places("GR", rows, digest.hexdigest(), SOURCE, provider_name="Eurostat GISCO",
                        provider_url=PROVIDER, license_name="CC BY-SA 4.0",
                        coverage_note="Greece suggestions use official Greek local-area names; edit the town if needed. " + NOTICE)
