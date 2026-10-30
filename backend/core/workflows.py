"""Business actions for the single-company dispatch application.

All API mutations run in one short, transaction-scoped PostgreSQL advisory lock.
This keeps cross-record actions (returns, handovers, retries) consistent for the
small shared dispatch team, while per-record versions detect stale browser edits.
"""
import json
from contextlib import contextmanager
from decimal import Decimal, ROUND_HALF_UP

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from core.models import AuditEvent
from orders.models import Cargo, Order, Stop
from reviews.models import Review
from trips.models import Attempt, Extra, Handover, Leg, Trip, Visit


class Conflict(APIException):
    status_code = 409
    default_detail = "Someone changed this record. Your entries are preserved; refresh and review the latest version."


@contextmanager
def mutation():
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [727194031])
        yield


def snapshot(obj):
    result = {}
    for field in obj._meta.concrete_fields:
        if field.name in {"password"}:
            continue
        value = getattr(obj, field.attname)
        if hasattr(value, "name"):
            value = value.name
        result[field.name] = value
    return json.loads(json.dumps(result, cls=DjangoJSONEncoder))


def audit(obj, user, action, before=None):
    AuditEvent.objects.create(actor=user, actor_name=str(user), resource=obj._meta.model_name,
                              object_id=obj.pk, action=action, before=before or {}, after=snapshot(obj))


def change(obj, user, action, **values):
    before = snapshot(obj)
    for key, value in values.items():
        setattr(obj, key, value)
    obj.version += 1
    obj.save()
    audit(obj, user, action, before)
    return obj


def require_version(obj, data):
    try:
        expected = int(data.get("version"))
    except (ValueError, TypeError):
        raise ValidationError({"version": "Include the version of the record you opened."})
    if expected != obj.version:
        raise Conflict({"detail": Conflict.default_detail, "latest_version": obj.version})


def reason_from(data):
    value = data.get("reason")
    if not isinstance(value, str) or not value.strip():
        raise ValidationError({"reason": "A reason is required."})
    return value.strip()


def financials(trip):
    revenue = Decimal("0")
    revenue_complete = True
    provisional = trip.actual_km is None or trip.rate is None or trip.status not in {"finished", "cancelled"}
    for leg in trip.legs.filter(is_cancelled=False).select_related("order"):
        if trip.status == "cancelled":
            continue
        order = leg.order
        legs = list(order.legs.filter(is_cancelled=False).exclude(trip__status="cancelled"))
        if len(legs) == 1:
            value = order.price
        else:
            value = leg.allocated_revenue
            if any(item.allocated_revenue is None for item in legs) or order.price is None or sum((item.allocated_revenue or Decimal("0") for item in legs), Decimal("0")) != order.price:
                provisional = True
                revenue_complete = False
        if value is None:
            provisional = True
            revenue_complete = False
        revenue += value or Decimal("0")
    km = trip.actual_km if trip.actual_km is not None else trip.estimated_km
    km = Decimal(str(km)) if km is not None else None
    rate = Decimal(str(trip.rate)) if trip.rate is not None else None
    extras = trip.extras.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    cost = extras if km == 0 else ((km * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) + extras) if km is not None and rate is not None else None
    if trip.status == "cancelled":
        provisional = False
    return {"revenue": str(revenue), "cost": str(cost) if cost is not None else None,
            "margin": str(revenue - cost) if cost is not None else None, "extras": str(extras), "provisional": provisional, "revenue_complete": revenue_complete}


def sync_order(order, user):
    if order.status in {"draft", "cancelled", "delivered"}:
        return
    stops = list(order.stops.all())
    if order.return_pending:
        returns = [stop for stop in stops if stop.kind == "return"]
        if returns and all(stop.status == "completed" for stop in returns):
            change(order, user, "return_completed", status="cancelled", return_pending=False, resolution="Returned to loading point")
        return
    required = [stop for stop in stops if stop.status != "cancelled" and stop.kind in {"collection", "delivery"}]
    if any(stop.kind == "delivery" and stop.status == "completed" for stop in required) and all(stop.status == "completed" for stop in required):
        change(order, user, "delivery_completed", status="delivered")
    elif order.status == "confirmed" and any(stop.kind == "collection" and stop.status in {"en_route", "arrived", "completed", "unsuccessful"} for stop in stops):
        change(order, user, "collection_started", status="in_progress")


def stop_location(stop):
    return {key: getattr(stop, key) for key in ["short_code", "location_name", "address", "city", "postal_code", "country", "timezone"]}


def sync_single_point_location(obj, values, user):
    """Keep a single-stop visit and its stop aligned as details arrive.

    Shared visits and completed work retain their independently recorded data.
    """
    location = {key: values[key] for key in ["short_code", "location_name", "address", "city", "postal_code", "country", "timezone"] if key in values}
    if not location or not isinstance(obj, (Stop, Visit)):
        return
    attempts = list(obj.attempts.filter(is_current=True).select_related("visit", "stop"))
    if len(attempts) != 1:
        return
    attempt = attempts[0]
    if attempt.visit.kind != "work" or attempt.visit.status in {"departed", "cancelled"} or attempt.stop.status in {"completed", "cancelled"}:
        return
    if attempt.visit.attempts.filter(is_current=True).count() != 1 or attempt.visit.orders.exists():
        return
    target = attempt.visit if isinstance(obj, Stop) else attempt.stop
    changes = {key: value for key, value in location.items() if getattr(target, key) != value}
    if changes:
        change(target, user, "location_details_updated", **changes)


def close_unused_visits(order, user):
    for visit in Visit.objects.filter(attempts__stop__order=order, kind="work", status__in=["planned", "en_route"]).distinct():
        if not visit.attempts.filter(is_current=True).exists():
            change(visit, user, "unused_visit_cancelled", status="cancelled")


def plan_attempt(stop, visit, user):
    if stop.status in {"completed", "cancelled"}:
        raise ValidationError("This stop is already completed or cancelled.")
    if stop.attempts.filter(is_current=True).exists():
        raise ValidationError("This stop already has a current attempt. Remove it or finish that attempt first.")
    if not Leg.objects.filter(order=stop.order, trip=visit.trip, is_cancelled=False, ended_at__isnull=True).exists():
        raise ValidationError("Assign this order to the visit's trip first.")
    if visit.trip.status in {"finished", "cancelled"} or visit.status in {"departed", "cancelled"}:
        raise ValidationError("Choose an open trip and visit.")
    current_status = visit.status if visit.status in {"en_route", "arrived"} else "planned"
    attempt = Attempt.objects.create(stop=stop, visit=visit, status=current_status)
    audit(attempt, user, "attempt_planned")
    change(stop, user, "retry_planned" if stop.status == "unsuccessful" else "stop_planned", status=current_status)
    sync_order(stop.order, user)
    return attempt


def validate_confirmation(order):
    errors = []
    if not order.client_id or not order.client.is_active:
        errors.append("Select an active client.")
    if order.price is None:
        errors.append("Enter the agreed client price in EUR.")
    for kind in ["collection", "delivery"]:
        stops = list(order.stops.filter(kind=kind).exclude(status="cancelled"))
        if not stops:
            errors.append(f"Add at least one {kind} stop.")
        if any(not (stop.short_code or stop.location_name or stop.city or stop.postal_code or stop.address) for stop in stops):
            errors.append(f"Give each {kind} an identifiable location; a full address is optional.")
    if not order.cargo.exists():
        errors.append("Add a cargo entry describing the goods.")
    if errors:
        raise ValidationError({"detail": errors})


def client_snapshot(order):
    client = order.client
    if not client:
        return {}
    contact = order.booking_contact
    return {"name": client.name, "country": client.country, "address": client.address, "tax_id": client.tax_id,
            "legal_name": client.legal_name, "registration_number": client.registration_number,
            "contact": {"name": contact.name, "email": contact.email, "phone": contact.phone, "role": contact.role} if contact else None}


def start_trip(trip, user):
    if trip.status != "planned":
        raise ValidationError("Only a planned trip can start.")
    if not all([trip.partner_id, trip.vehicle_id, trip.driver_id]) or trip.rate is None:
        raise ValidationError("Partner, van, driver and agreed rate are required before starting.")
    if trip.vehicle.status != "active" or not trip.driver.is_active or not trip.partner.is_active:
        raise ValidationError("The selected partner, van and driver must be active and the van usable.")
    change(trip, user, "trip_started", status="in_progress", started_at=timezone.now())


def cancel_order(order, data, user):
    if order.status in {"cancelled", "delivered"} or order.return_pending:
        raise ValidationError("This order is already closed or awaiting return.")
    reason = reason_from(data)
    loaded = list(order.stops.filter(kind="collection", status="completed"))
    if loaded:
        change(order, user, "cancellation_return_requested", status="in_progress", return_pending=True, cancellation_reason=reason)
        for stop in order.stops.exclude(status__in=["completed", "cancelled"]):
            for attempt in stop.attempts.filter(is_current=True):
                change(attempt, user, "attempt_cancelled", status="cancelled", is_current=False, reason=reason)
            change(stop, user, "stop_cancelled", status="cancelled", reason=reason)
        for collection in loaded:
            stop = Stop.objects.create(order=order, kind="return", position=order.stops.count() + 1,
                                       return_of=collection, instructions="Return goods to loading point: " + reason,
                                       **stop_location(collection))
            audit(stop, user, "return_stop_created")
    else:
        was_enroute = order.stops.filter(attempts__status__in=["en_route", "arrived"]).exists()
        for stop in order.stops.exclude(status="cancelled"):
            for attempt in stop.attempts.filter(is_current=True):
                change(attempt, user, "attempt_cancelled", status="cancelled", is_current=False, reason=reason)
            change(stop, user, "stop_cancelled", status="cancelled", reason=reason)
        change(order, user, "order_cancelled", status="cancelled", cancellation_reason=reason)
        if was_enroute:
            Review.objects.create(kind="enroute_cancel", order=order, requested_by=user, reason=reason)
    close_unused_visits(order, user)


def handover(order, data, user):
    if order.status != "in_progress" or not order.stops.filter(kind="collection", status="completed").exists():
        raise ValidationError("A handover requires an in-progress order with collected goods.")
    try:
        source = order.legs.get(pk=data.get("from_leg"), is_cancelled=False, ended_at__isnull=True)
        receiving = Trip.objects.get(pk=data.get("to_trip"))
    except (Leg.DoesNotExist, Trip.DoesNotExist, ValueError, TypeError):
        raise ValidationError("Select an active source leg and a receiving trip.")
    if source.trip_id == receiving.pk or receiving.status not in {"planned", "in_progress"}:
        raise ValidationError("Select a different planned or in-progress receiving trip.")
    if source.trip.vehicle_id == receiving.vehicle_id:
        raise ValidationError("A goods handover requires a different receiving van.")
    reason = reason_from(data)
    location = str(data.get("location", "")).strip()
    if not location:
        raise ValidationError({"location": "Enter the actual handover location."})
    if receiving.status == "planned":
        start_trip(receiving, user)
    now = timezone.now()
    to_leg = Leg.objects.create(order=order, trip=receiving, sequence=order.legs.count() + 1)
    audit(to_leg, user, "handover_leg_created")
    event = Handover.objects.create(order=order, from_leg=source, to_leg=to_leg, location=location, occurred_at=now,
                                   reason=reason, is_emergency=data.get("is_emergency", True))
    audit(event, user, "handover_recorded")
    change(source, user, "leg_handed_over", ended_at=now)
    for trip in [source.trip, receiving]:
        visit = Visit.objects.create(trip=trip, kind="handover", location_name=location,
                                     position=trip.visits.count() + 1, status="departed", arrived_at=now, departed_at=now)
        audit(visit, user, "handover_visit")
    for stop in order.stops.exclude(status__in=["completed", "cancelled"]):
        for attempt in stop.attempts.filter(is_current=True):
            change(attempt, user, "attempt_transferred", status="cancelled", is_current=False, reason=reason)
        visit = Visit.objects.create(trip=receiving, position=receiving.visits.count() + 1, **stop_location(stop))
        plan_attempt(stop, visit, user)
    if event.is_emergency:
        Review.objects.create(kind="handover", order=order, requested_by=user, reason=reason, payload={"handover": event.pk})
    close_unused_visits(order, user)
    change(order, user, "goods_handed_over")
    change(source.trip, user, "handover_out")
    change(receiving, user, "handover_in")


def perform(obj, command, data, user):
    if isinstance(obj, Order):
        if command == "confirm" and obj.status == "draft":
            validate_confirmation(obj)
            change(obj, user, "order_confirmed", status="confirmed", client_snapshot=client_snapshot(obj))
        elif command == "complete":
            from orders.completion import complete_order
            complete_order(obj, data, user)
        elif command == "cancel":
            cancel_order(obj, data, user)
        elif command == "request_reopen" and obj.status == "delivered":
            reason = reason_from(data)
            stop_id = data.get("stop")
            if not obj.stops.filter(pk=stop_id, status="completed").exists():
                raise ValidationError("Select the completed stop that needs correction.")
            if obj.reviews.filter(kind="reopen_order", status="pending").exists():
                raise ValidationError("A reopening request is already pending.")
            Review.objects.create(kind="reopen_order", order=obj, requested_by=user, reason=reason,
                                  payload={"stop": int(stop_id), "stop_version": obj.stops.get(pk=stop_id).version, "order_version": obj.version + 1})
            change(obj, user, "reopening_requested")
        elif command == "handover":
            handover(obj, data, user)
        else:
            raise ValidationError("This action is not available for this order.")
    elif isinstance(obj, Trip):
        if command == "assign_order":
            if obj.status in {"finished", "cancelled"}:
                raise ValidationError("Choose an open trip.")
            try:
                order = Order.objects.get(pk=data.get("order"))
            except (Order.DoesNotExist, ValueError, TypeError):
                raise ValidationError("Choose an order.")
            if order.status in {"delivered", "cancelled"} or order.legs.filter(is_cancelled=False, ended_at__isnull=True).exists():
                raise ValidationError("Choose an open order without an active assignment, or release its planned assignment first.")
            leg = Leg.objects.create(order=order, trip=obj, sequence=order.legs.count() + 1)
            audit(leg, user, "order_assigned")
            for stop in order.stops.exclude(status__in=["completed", "cancelled"]):
                visit = Visit.objects.create(trip=obj, position=obj.visits.count() + 1, **stop_location(stop))
                audit(visit, user, "visit_planned")
                plan_attempt(stop, visit, user)
            change(obj, user, "order_assigned")
        elif command == "plan_outstanding":
            for leg in obj.legs.filter(is_cancelled=False, ended_at__isnull=True):
                for stop in leg.order.stops.exclude(status__in=["completed", "cancelled"]):
                    if not stop.attempts.filter(is_current=True).exists():
                        visit = Visit.objects.create(trip=obj, position=obj.visits.count() + 1, **stop_location(stop))
                        audit(visit, user, "visit_planned")
                        plan_attempt(stop, visit, user)
            change(obj, user, "outstanding_work_planned")
        elif command == "reorder":
            visits = list(obj.visits.all())
            ids = data.get("visits", [])
            if len(ids) != len(set(ids)) or set(ids) != {visit.pk for visit in visits}:
                raise Conflict("The route changed. Refresh the visits before reordering.")
            versions = data.get("versions", {})
            for visit in visits:
                if versions.get(str(visit.pk)) != visit.version:
                    raise Conflict("A visit changed. Refresh before reordering.")
                new_position = ids.index(visit.pk) + 1
                if visit.position != new_position:
                    change(visit, user, "visit_reordered", position=new_position)
            change(obj, user, "route_reordered")
        elif command == "start":
            start_trip(obj, user)
        elif command == "interrupt" and obj.status == "in_progress":
            change(obj, user, "trip_interrupted", status="interrupted", end_reason=reason_from(data))
        elif command == "resume" and obj.status == "interrupted":
            change(obj, user, "trip_resumed", status="in_progress")
        elif command == "finish" and obj.status in {"in_progress", "interrupted"}:
            if obj.visits.filter(attempts__is_current=True).exists() or obj.visits.exclude(status__in=["departed", "cancelled"]).exists():
                raise ValidationError("Resolve remaining tasks and depart/cancel outstanding visits first.")
            change(obj, user, "trip_finished", status="finished", finished_at=timezone.now(), end_reason=data.get("reason", ""))
        elif command == "cancel" and obj.status == "planned":
            if obj.actual_km or obj.legs.filter(order__status="delivered").exists() or Attempt.objects.filter(visit__trip=obj, status="completed").exists():
                raise ValidationError("This trip contains recorded travel or completed shipment work. Keep its kilometres and completion history instead of cancelling it as untravelled.")
            reason = reason_from(data)
            for attempt in Attempt.objects.filter(visit__trip=obj, is_current=True):
                change(attempt, user, "attempt_removed", status="cancelled", is_current=False, reason=reason)
                change(attempt.stop, user, "awaiting_rescheduling", status="planned")
            for visit in obj.visits.exclude(status="cancelled"):
                change(visit, user, "visit_cancelled", status="cancelled")
            change(obj, user, "trip_cancelled", status="cancelled", actual_km=Decimal("0"), end_reason=reason)
        else:
            raise ValidationError("This action is not available for this trip.")
    elif isinstance(obj, Visit):
        if command != "cancel" and obj.trip.status not in {"in_progress", "interrupted"}:
            raise ValidationError("Start the trip before recording visit progress.")
        if command in {"en_route", "arrive"}:
            expected = {"en_route": "planned", "arrive": "en_route"}[command]
            if obj.status != expected:
                raise ValidationError(f"This visit must be {expected.replace('_', ' ')} first.")
            target = "en_route" if command == "en_route" else "arrived"
            for attempt in obj.attempts.filter(is_current=True):
                if attempt.stop.order.status == "draft":
                    raise ValidationError("Confirm included orders before beginning their work.")
            values = {"status": target}
            if target == "arrived":
                values["arrived_at"] = timezone.now()
            change(obj, user, "visit_" + target, **values)
            for attempt in obj.attempts.filter(is_current=True):
                change(attempt, user, "attempt_" + target, status=target)
                change(attempt.stop, user, "stop_" + target, status=target)
                sync_order(attempt.stop.order, user)
        elif command == "depart" and obj.status == "arrived":
            if obj.attempts.filter(is_current=True).exists():
                raise ValidationError("Record each task's outcome before departing.")
            change(obj, user, "visit_departed", status="departed", departed_at=timezone.now())
        elif command == "cancel" and obj.status in {"planned", "en_route"}:
            reason = reason_from(data)
            for attempt in obj.attempts.filter(is_current=True):
                change(attempt, user, "attempt_removed", status="cancelled", is_current=False, reason=reason)
                change(attempt.stop, user, "awaiting_rescheduling", status="planned")
            change(obj, user, "visit_cancelled", status="cancelled")
        else:
            raise ValidationError("This action is not available for this visit.")
    elif isinstance(obj, Attempt):
        if not obj.is_current:
            raise ValidationError("This is a historical attempt.")
        stop = obj.stop
        if command in {"complete", "fail"}:
            if obj.visit.status != "arrived":
                raise ValidationError("Mark the visit Arrived first.")
            if command == "complete" and stop.kind == "delivery":
                for cargo in stop.cargo_delivered.select_related("collection"):
                    if cargo.collection.status != "completed":
                        raise ValidationError("Collect this delivery's goods before completing delivery.")
            target = "completed" if command == "complete" else "unsuccessful"
            reason = reason_from(data) if command == "fail" else ""
            change(obj, user, "attempt_" + target, status=target, is_current=False, reason=reason, completed_at=timezone.now())
            change(stop, user, "stop_" + target, status=target, reason=reason)
            sync_order(stop.order, user)
        elif command == "remove" and obj.status == "planned":
            change(obj, user, "attempt_removed", status="cancelled", is_current=False, reason=reason_from(data))
            change(stop, user, "awaiting_rescheduling", status="planned")
        else:
            raise ValidationError("This action is not available for this attempt.")
    elif isinstance(obj, Review):
        if not user.is_manager:
            raise PermissionDenied("Only a manager can decide this request.")
        if obj.status != "pending":
            raise ValidationError("This request was already decided.")
        if command not in {"approve", "reject", "review"}:
            raise ValidationError("Choose approve, reject or review.")
        if obj.kind == "reopen_order":
            if command not in {"approve", "reject"}:
                raise ValidationError("Approve or reject this request.")
            order = obj.order
            if command == "approve":
                stop = order.stops.get(pk=obj.payload["stop"])
                if order.version != obj.payload.get("order_version") or order.status != "delivered" or stop.version != obj.payload.get("stop_version"):
                    raise Conflict("The order or stop changed after this request. Reject it and request a new review of the current information.")
                change(stop, user, "stop_reopened", status="planned")
                change(order, user, "order_reopened", status="in_progress")
        elif command != "review":
            raise ValidationError("This action already happened; mark the review as reviewed.")
        change(obj, user, "review_" + command, status={"approve": "approved", "reject": "rejected", "review": "reviewed"}[command],
               decided_by=user, decided_at=timezone.now(), decision_note=data.get("note", ""))
    else:
        raise ValidationError("No workflow action is available for this record.")
    obj.refresh_from_db()
    return obj

