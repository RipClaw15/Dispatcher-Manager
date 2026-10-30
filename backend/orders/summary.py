from core.workflows import financials
from directory.countries import compact_route, country_lookup, resolve_country


def dispatch_summary(order, cache, countries=None):
    countries = countries if countries is not None else country_lookup()
    legs = [leg for leg in order.legs.all() if not leg.is_cancelled]
    active = [leg for leg in legs if leg.ended_at is None]
    leg = (active or legs)[-1] if legs else None
    trip = leg.trip if leg else None
    points = []
    for stop in order.stops.all():
        attempts = [attempt for attempt in stop.attempts.all() if attempt.is_current and (not trip or attempt.visit.trip_id == trip.pk)]
        position = attempts[0].visit.position if attempts else stop.position
        points.append({"kind": stop.kind, "code": stop.short_code or stop.postal_code or stop.city or stop.location_name or stop.address,
                       "country": resolve_country(stop.country, stop.short_code, countries),
                       "position": position, "id": stop.pk, "resource": "stops", "status": stop.status})
    for visit in order.customs_visits.all():
        if visit.kind == "customs" and (not trip or visit.trip_id == trip.pk):
            points.append({"kind": "customs", "code": visit.short_code or visit.postal_code or visit.city or visit.location_name or visit.address,
                           "country": resolve_country(visit.country, visit.short_code, countries),
                           "position": visit.position, "id": visit.pk, "resource": "visits", "status": visit.status})
    points.sort(key=lambda point: (point["position"], point["id"]))
    starting = trip.starting_code if trip else ""
    display = compact_route(([{"code": starting, "kind": "start", "country": resolve_country(trip.starting_country, starting, countries)}] if trip else []) + points)
    route = " → ".join(point["code"] for point in display)
    result = {"vehicle_label": str(trip.vehicle) if trip and trip.vehicle else "", "driver_label": str(trip.driver) if trip and trip.driver else "", "starting_code": starting,
              "route": points, "display_route": display, "route_label": route, "client_label": order.client_snapshot.get("name") or (str(order.client) if order.client else ""),
              "price": str(order.price) if order.price is not None else None, "trip_id": trip.pk if trip else None,
              "trip_count": len({leg.trip_id for leg in legs}), "km": None, "margin": None, "cost": None, "rate": None,
              "shared": False, "provisional": True}
    result["driver_citizenship"] = trip.driver.citizenship if trip and trip.driver else ""
    if trip:
        if trip.pk not in cache:
            cache[trip.pk] = financials(trip)
        figures = cache[trip.pk]
        km = trip.actual_km if trip.actual_km is not None else trip.estimated_km
        result.update(km=str(km) if km is not None else None, margin=figures["margin"], cost=figures["cost"],
                      rate=str(trip.rate) if trip.rate is not None else None, provisional=figures["provisional"],
                      shared=trip.legs.filter(is_cancelled=False).values("order_id").distinct().count() > 1,
                      revenue=figures["revenue"])
        if not figures["revenue_complete"]:
            result["margin"] = None
    return result
