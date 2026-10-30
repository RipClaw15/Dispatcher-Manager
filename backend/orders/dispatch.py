"""Assignment corrections from an existing order, without duplicating its trip."""
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from core.models import AuditEvent
from core.workflows import audit, require_version, snapshot, plan_attempt, stop_location
from fleet.models import Driver, Vehicle
from orders.models import Order
from trips.models import Leg, Trip, Visit


class DispatchEditSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    trip = serializers.PrimaryKeyRelatedField(queryset=Trip.objects.all(), required=False, allow_null=True)
    trip_version = serializers.IntegerField(min_value=1, required=False)
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all(), required=False, allow_null=True)
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all(), required=False, allow_null=True)
    starting_code = serializers.CharField(max_length=40, required=False, allow_blank=True)
    starting_country = serializers.CharField(max_length=80, required=False, allow_blank=True)


def edit_dispatch(order, data, user, trip_serializer, context):
    require_version(order, data)
    trip = data.get("trip")
    if trip:
        if not order.legs.filter(trip=trip, is_cancelled=False).exists():
            raise ValidationError({"trip": "Choose a trip assigned to this order."})
        require_version(trip, {"version": data.get("trip_version")})
    elif order.legs.filter(is_cancelled=False).exists():
        raise ValidationError({"trip": "Select the existing assignment to correct; do not create a duplicate trip."})
    elif order.status not in {"draft", "confirmed"}:
        raise ValidationError("Only an open, unassigned order can receive a new planned trip.")

    vehicle = data.get("vehicle", trip.vehicle if trip else None)
    driver = data.get("driver", trip.driver if trip else None)
    if vehicle and vehicle.status != "active" and (not trip or vehicle.pk != trip.vehicle_id):
        raise ValidationError({"vehicle": "Choose an active, usable van."})
    partner = (vehicle.partner if vehicle and vehicle.partner_id else
               driver.partner if driver and driver.partner_id else trip.partner if trip else None)
    # A recorded assignment correction must not silently reprice the journey.
    rate = trip.rate if trip and trip.rate is not None else vehicle.default_rate if vehicle else None
    values = {"vehicle": vehicle.pk if vehicle else None, "driver": driver.pk if driver else None,
              "partner": partner.pk if partner else None, "rate": str(rate) if rate is not None else None,
              "starting_code": data.get("starting_code", trip.starting_code if trip else "")}
    values["starting_country"] = data.get("starting_country", trip.starting_country if trip else "")
    if not trip:
        values["dispatcher"] = order.dispatcher_id
    serializer = trip_serializer(trip, data=values, partial=bool(trip), context=context)
    serializer.is_valid(raise_exception=True)
    before = snapshot(trip) if trip else {}
    trip = serializer.save(version=trip.version + 1) if trip else serializer.save(quick_entry=order.quick_entry)
    audit(trip, user, "dispatch_details_updated" if before else "order_trip_created", before=before)
    if not before:
        leg = Leg.objects.create(order=order, trip=trip)
        audit(leg, user, "created")
        for stop in order.stops.filter(status="planned").order_by("position", "pk"):
            if not stop.attempts.filter(is_current=True).exists():
                visit = Visit.objects.create(trip=trip, position=stop.position, **stop_location(stop))
                audit(visit, user, "visit_planned")
                plan_attempt(stop, visit, user)
    original = snapshot(order)
    order.version += 1
    order.save(update_fields=["version", "updated_at"])
    AuditEvent.objects.create(actor=user, actor_name=str(user), resource="order", object_id=order.pk,
                              action="dispatch_details_updated", before=original,
                              after={**snapshot(order), "trip": trip.pk, "vehicle": trip.vehicle_id,
                                     "driver": trip.driver_id, "starting_code": trip.starting_code})
    return trip
