"""Eurostat's released postcode/local-area CSV, limited to the requested EEA."""
import csv
import hashlib
from collections import defaultdict
from pathlib import Path

from directory.postcodes import folded, store_places
from directory.postal_scope import EEA_COUNTRIES

SOURCE = "https://gisco-services.ec.europa.eu/distribution/v2/pcode/csv/PCODE_PT_2025_4326.csv"
PROVIDER = "https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units/postal-codes"
NOTICE = "© European Union - GISCO, 2024, postal code point dataset, Licence CC-BY-SA 4.0."


def import_eurostat_csv(path, countries=EEA_COUNTRIES, progress=None):
    digest = hashlib.sha256()
    with Path(path).open("rb") as raw:
        for block in iter(lambda: raw.read(1024 * 1024), b""):
            digest.update(block)
    rows, names = defaultdict(dict), defaultdict(dict)
    selected = set(countries)
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"CNTR_ID", "POSTCODE", "LAU_NAME"}
        if not required <= set(reader.fieldnames or []):
            raise ValueError("The Eurostat CSV must contain CNTR_ID, POSTCODE and LAU_NAME.")
        for number, row in enumerate(reader, 2):
            country = {"EL": "GR", "UK": "GB"}.get(row["CNTR_ID"], row["CNTR_ID"])
            if country not in selected:
                continue
            postcode = (row["POSTCODE"] or "").strip()
            place = (row["LAU_NAME"] or "").strip()
            if not postcode or len(postcode) > 20 or len(place) > 180:
                raise ValueError(f"Invalid postcode/local-area record at CSV line {number}.")
            if place not in names[country]:
                names[country][place] = (place, folded(place))
            canonical, search_name = names[country][place]
            rows[country][(postcode, canonical, "")] = search_name
    missing = selected - rows.keys()
    if missing:
        raise ValueError(f"Eurostat has no records for {', '.join(sorted(missing))}; no datasets were replaced.")
    result = {}
    for country in sorted(selected):
        precision = "prefix" if country in {"IE", "MT"} else "postcode"
        note = "Eurostat supplies local administrative-area names; edit the town if the delivery locality differs."
        if precision == "prefix":
            note += " Only postcode prefixes are supplied here; complete the full postcode manually when known."
        if country == "GR":
            note += " Greek local-area names are shown in Greek."
        note += " " + NOTICE
        dataset = store_places(country, rows[country], digest.hexdigest(), SOURCE,
                               provider_name="Eurostat GISCO", provider_url=PROVIDER,
                               license_name="CC BY-SA 4.0", coverage_note=note, postcode_precision=precision)
        result[country] = dataset.row_count
        if progress:
            progress(country, dataset.row_count)
    return result
