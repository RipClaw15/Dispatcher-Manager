"""Atomic entry of the dispatch notebook: one booking and its journey plan."""
from django.db.models import Max
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from accounts.models import User
from core.workflows import audit, change, require_version
from directory.models import Client, Contact
from fleet.models import Vehicle
from orders.models import Cargo, Order, Stop
from trips.models import Attempt, Leg, Trip, Visit

LOCATION_FIELDS = ["short_code", "location_name", "address", "city", "postal_code", "country"]


class RoutePointSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["collection", "delivery", "customs"])
    short_code = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    location_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    address = serializers.CharField(required=False, allow_blank=True, default="")
    city = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    postal_code = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    country = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    planned_date = serializers.DateField(required=False, allow_null=True)


class QuickEntrySerializer(serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.exclude(status="inactive"), required=False, allow_null=True)
    trip = serializers.PrimaryKeyRelatedField(queryset=Trip.objects.all(), required=False, allow_null=True)
    trip_version = serializers.IntegerField(required=False, min_value=1)
    starting_code = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    starting_country = serializers.CharField(max_length=80, required=False, allow_blank=True)
    route = RoutePointSerializer(many=True, required=False, default=list, max_length=40)
    client = serializers.PrimaryKeyRelatedField(queryset=Client.objects.filter(is_active=True), required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True, min_value=0)
    estimated_km = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=0)
    rate = serializers.DecimalField(max_digits=8, decimal_places=4, required=False, allow_null=True, min_value=0)
    rate_reason = serializers.CharField(max_length=250, required=False, allow_blank=True, default="")
    dispatcher = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), required=False, allow_null=True)
    booking_contact = serializers.PrimaryKeyRelatedField(queryset=Contact.objects.all(), required=False, allow_null=True)
    client_reference = serializers.CharField(max_length=180, required=False, allow_blank=True, default="")
    date_received = serializers.DateField(required=False, default=timezone.localdate)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    cargo_description = serializers.CharField(max_length=250, required=False, allow_blank=True, default="")

    def validate(self, data):
        trip, vehicle = data.get("trip"), data.get("vehicle")
        if vehicle and vehicle.status != "active":
            raise ValidationError({"vehicle": "Choose an active, usable van or leave it unassigned."})
        if data.get("booking_contact") and (not data.get("client") or data["booking_contact"].client_id != data["client"].pk):
            raise ValidationError({"booking_contact": "Choose a contact belonging to the ordering client."})
        if trip:
            require_version(trip, {"version": data.get("trip_version")})
            if trip.status not in {"planned", "in_progress"}:
                raise ValidationError({"trip": "Choose a planned or in-progress trip."})
            if trip.vehicle_id != (vehicle.pk if vehicle else None):
                raise ValidationError({"vehicle": "Use the selected trip's van. Resource changes belong in trip planning."})
            if data.get("starting_code") != trip.starting_code:
                raise ValidationError({"starting_code": "An existing trip keeps its starting position. Edit that trip separately if needed."})
            if "starting_country" in data and data["starting_country"] != trip.starting_country:
                raise ValidationError({"starting_country": "An existing trip keeps its starting country. Edit that trip separately if needed."})
            if data.get("rate") is not None and data["rate"] != trip.rate:
                raise ValidationError({"rate": "An existing trip keeps its agreed rate. Edit the trip to agree a different rate."})
        elif vehicle:
            if data.get("rate") is None:
                data["rate"] = vehicle.default_rate
            if data["rate"] != vehicle.default_rate and not data.get("rate_reason"):
                raise ValidationError({"rate_reason": "Explain the different agreed whole-trip rate."})
        points = [point for point in data["route"] if any(point.get(key) for key in LOCATION_FIELDS)
                  or (point["kind"] == "collection" and point.get("planned_date") is not None)]
        data["route"] = points
        if data.get("cargo_description") and (sum(point["kind"] == "collection" for point in points) != 1 or sum(point["kind"] == "delivery" for point in points) != 1):
            raise ValidationError({"cargo_description": "Add cargo in shipment details when the route has multiple collection or delivery points."})
        return data


def create_quick_order(data, user):
    order_fields = {key: data[key] for key in ["client", "price", "booking_contact", "client_reference", "date_received", "notes"] if key in data}
    dispatcher = data.get("dispatcher") or user
    order = Order.objects.create(dispatcher=dispatcher, quick_entry=True,
                                 customs_required=any(point["kind"] == "customs" for point in data["route"]), **order_fields)
    audit(order, user, "created")
    trip = data.get("trip")
    vehicle = data.get("vehicle")
    if not trip and (vehicle or data["route"] or data["starting_code"] or data.get("estimated_km") is not None or data.get("rate") is not None):
        trip = Trip.objects.create(dispatcher=dispatcher, quick_entry=True, vehicle=vehicle,
                                   partner=vehicle.partner if vehicle else None, starting_code=data["starting_code"],
                                   starting_country=data.get("starting_country", ""),
                                   estimated_km=data.get("estimated_km"), rate=data.get("rate"), rate_reason=data["rate_reason"],
                                   name=" → ".join(filter(None, [data["starting_code"]] + [point["short_code"] for point in data["route"]]))[:200])
        audit(trip, user, "quick_trip_created")
    elif trip:
        values = {"estimated_km": data["estimated_km"]} if "estimated_km" in data else {}
        change(trip, user, "quick_order_added", **values)
    if trip:
        leg = Leg.objects.create(order=order, trip=trip)
        audit(leg, user, "created")
    position = (trip.visits.aggregate(last=Max("position"))["last"] or 0) if trip else 0
    stops = []
    for index, point in enumerate(data["route"], start=position + 1):
        location = {key: point[key] for key in LOCATION_FIELDS}
        visit = Visit.objects.create(trip=trip, kind="customs" if point["kind"] == "customs" else "work", position=index, **location)
        audit(visit, user, "quick_visit_created")
        if point["kind"] == "customs":
            visit.orders.add(order)
        else:
            planned_date = point.get("planned_date")
            stop = Stop.objects.create(order=order, kind=point["kind"], position=index,
                                       planned_date=planned_date, timing="date" if planned_date else "unknown", **location)
            audit(stop, user, "created")
            attempt = Attempt.objects.create(stop=stop, visit=visit)
            audit(attempt, user, "attempt_planned")
            stops.append(stop)
    if data.get("cargo_description"):
        cargo = Cargo.objects.create(order=order, collection=next(stop for stop in stops if stop.kind == "collection"),
                                     delivery=next(stop for stop in stops if stop.kind == "delivery"), description=data["cargo_description"])
        audit(cargo, user, "created")
    return order
