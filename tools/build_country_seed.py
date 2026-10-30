"""Generate the versioned European/nearby reference list from flag-icons data.

Source and artwork: https://github.com/lipis/flag-icons (MIT).
Run only when intentionally updating the checked-in reference dataset.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = json.loads((root / "frontend/node_modules/flag-icons/country.json").read_text(encoding="utf-8"))
nearby = {"ma", "dz", "tn", "ly", "eg", "tr", "cy", "ge", "am", "az", "kz", "il", "ps", "lb", "sy", "jo", "iq", "ir", "xk"}
aliases = {"gb": ["UK", "Great Britain", "Britain"], "gr": ["EL"], "cz": ["Czech Republic"], "tr": ["Turkey", "Türkiye"], "va": ["Vatican", "Holy See"]}
countries = [{"name": item["name"], "code": item["code"].upper(), "aliases": aliases.get(item["code"], [])}
             for item in data if len(item["code"]) == 2 and ((item.get("continent") == "Europe" and item.get("iso")) or item["code"] in nearby)]
target = root / "backend/directory/data/europe-countries.json"
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(sorted(countries, key=lambda item: item["name"]), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Saved {len(countries)} countries and nearby territories.")

uk_codes = {"gb-eng", "gb-nir", "gb-sct", "gb-wls"}
uk_countries = [{"name": item["name"], "code": item["code"].upper(),
                 "aliases": [item["code"].split("-")[1].upper(), item["code"].upper().replace("GB-", "UK-")]}
                for item in data if item["code"] in uk_codes]
if len(uk_countries) != 4:
    raise ValueError("The installed flag-icons dataset must contain all four UK country flags.")
(target.parent / "uk-countries.json").write_text(json.dumps(sorted(uk_countries, key=lambda item: item["name"]), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Saved {len(uk_countries)} UK country entries.")
