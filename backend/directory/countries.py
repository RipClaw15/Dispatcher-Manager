"""Country resolution supports old free text and new saved directory codes."""
import re

from directory.models import Country


def country_lookup():
    lookup = {}
    for country in Country.objects.all():
        descriptor = {"name": country.name, "code": country.code, "key": country.code or f"custom:{country.pk}"}
        for value in [country.name, country.code, *country.aliases]:
            if value:
                lookup[value.strip().casefold()] = descriptor
    return lookup


def resolve_country(value, short_code, lookup):
    if value and value.strip():
        return lookup.get(value.strip().casefold(), {"name": value.strip(), "code": "", "key": value.strip().casefold()})
    prefix = re.match(r"^([A-Za-z]{2})(?=[\d\s-]|$)", short_code.strip())
    return lookup.get(prefix[1].casefold()) if prefix else None


def compact_route(points):
    """Compress adjacent locations, never a return after visiting another area."""
    result = []
    for point in points:
        code = point.get("code", "").strip()
        if not code:
            continue
        key = (code.casefold(), (point.get("country") or {}).get("key", ""))
        if result:
            previous = result[-1]
            previous_key = (previous["code"].strip().casefold(), (previous.get("country") or {}).get("key", ""))
            if key == previous_key:
                continue
        result.append(point)
    return result
