"""Deletion of entry mistakes, without removing operational history.

Preview and execution use the same policy. A signed confirmation binds deletion
to the exact set of record versions reviewed, including an order's child rows.
Call these functions inside workflows.mutation() to serialize dependency checks.
"""
from collections import Counter

from django.core import signing
from django.db.models.deletion import ProtectedError
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied, ValidationError

from core.models import AuditEvent
from core.workflows import Conflict, snapshot
from directory.models import Client, Contact, Location, Partner
from documents.models import Document, DocumentLink
from fleet.models import Driver, Vehicle
from orders.models import Order
from trips.models import Attempt, Leg, Trip, Visit

PROFILES = {Client, Partner, Driver, Vehicle, Contact, Location}
SUPPORTED = PROFILES | {Order, Trip, Document}
RESOURCES = {Client: "clients", Partner: "partners", Driver: "drivers", Vehicle: "vehicles",
             Contact: "contacts", Location: "locations", Order: "orders", Trip: "trips",
             Document: "documents"}
DOCUMENT_TARGETS = {**RESOURCES}
SALT = "dispatch.delete-confirmation.v1"


def quick_plan_children(order):
    """Remove only untouched planning rows owned by this quick-entry draft."""
    legs = list(order.legs.select_related("trip"))
    if any(leg.trip.status != "planned" or leg.trip.started_at or leg.trip.actual_km or leg.ended_at or leg.is_cancelled for leg in legs):
        return [], ["This order belongs to a trip with activity. Keep its planning history and cancel the booking instead."]
    attempts = list(Attempt.objects.filter(stop__order=order))
    if any(attempt.status != "planned" or not attempt.is_current or attempt.completed_at for attempt in attempts):
        return [], ["This order has task history and cannot be deleted."]
    visits = list(Visit.objects.filter(pk__in={attempt.visit_id for attempt in attempts} | set(order.customs_visits.values_list("pk", flat=True))).order_by("pk"))
    if any(visit.status != "planned" or visit.arrived_at or visit.departed_at for visit in visits):
        return [], ["This order has visit activity and cannot be deleted."]
    removable_visits = [visit for visit in visits if not visit.attempts.exclude(stop__order=order).exists() and not visit.orders.exclude(pk=order.pk).exists()]
    trips = []
    for leg in legs:
        trip = leg.trip
        if trip.quick_entry and not trip.legs.exclude(order=order).exists() and not trip.extras.exists() and not trip.visits.exclude(pk__in=[visit.pk for visit in removable_visits]).exists():
            trips.append(trip)
    return attempts + removable_visits + legs + trips, []


def record_label(obj):
    return getattr(obj, "reference", None) or getattr(obj, "title", None) or str(obj)


def deletion_plan(obj, user):
    model = type(obj)
    if model not in SUPPORTED:
        raise MethodNotAllowed("DELETE", "This record keeps operational or account history and cannot be deleted.")
    if model in PROFILES and not user.is_manager:
        raise PermissionDenied("Only managers can delete business profiles.")

    blockers = []
    children = []
    if isinstance(obj, Order):
        if obj.status != "draft":
            blockers.append("Only draft orders can be deleted. Cancel a genuine booking instead.")
        stops = list(obj.stops.order_by("pk"))
        if any(stop.status != "planned" for stop in stops) or obj.return_pending:
            blockers.append("This order has operational activity. Keep its history and use cancellation instead.")
        children = list(obj.cargo.order_by("pk")) + sorted(stops, key=lambda stop: stop.kind != "return")
        if obj.quick_entry and obj.status == "draft":
            planning, issues = quick_plan_children(obj)
            blockers.extend(issues)
            # Attempts precede stops; legs/visits precede their trip.
            children = [record for record in planning if isinstance(record, Attempt)] + children + [record for record in planning if not isinstance(record, Attempt)]
    elif isinstance(obj, Trip):
        if obj.status != "planned" or obj.started_at or obj.finished_at or obj.actual_km:
            blockers.append("Only unstarted planned trips can be deleted. Keep travelled kilometres and costs in history.")
        children = list(obj.visits.order_by("pk"))
        if any(visit.status != "planned" or visit.arrived_at or visit.departed_at for visit in children):
            blockers.append("This trip has visit activity and cannot be deleted.")
        if any(visit.orders.exists() for visit in children):
            blockers.append("This trip has visits linked to orders. Keep the trip or remove those planning links first.")

    records = children + [obj]
    planned_ids = {}
    for record in records:
        planned_ids.setdefault(type(record), []).append(record.pk)

    # Inspect every inbound relation, including SET_NULL and M2M relations.
    # Deletion must not silently detach a usual van or an order's contact.
    for record in records:
        for relation in record._meta.related_objects:
            references = relation.related_model._default_manager.filter(**{relation.field.name: record})
            references = references.exclude(pk__in=planned_ids.get(relation.related_model, []))
            if references.exists():
                blockers.append(f"{record_label(record)} is linked to {relation.related_model._meta.verbose_name_plural}. Remove unused links first, or keep this record for history.")
        resource = DOCUMENT_TARGETS.get(type(record))
        # Stops/visits can also hold private document links.
        resource = resource or {"stop": "stops", "visit": "visits"}.get(record._meta.model_name)
        if resource and DocumentLink.objects.filter(resource=resource, object_id=record.pk).exists():
            blockers.append(f"{record_label(record)} has linked documents. The record and its documents must be retained.")

    counts = Counter(record._meta.model_name for record in records)
    payload = {"user": user.pk, "records": sorted([record._meta.label_lower, record.pk, record.version] for record in records)}
    return records, {
        "allowed": not blockers,
        "label": record_label(obj),
        "version": obj.version,
        "blockers": list(dict.fromkeys(blockers)),
        "items": [{"kind": kind, "count": count} for kind, count in counts.items()],
        "confirmation_token": signing.dumps(payload, salt=SALT) if not blockers else None,
    }, payload


def delete_record(obj, user, token):
    records, preview, payload = deletion_plan(obj, user)
    if not preview["allowed"]:
        raise Conflict({"detail": "This record cannot be deleted.", "blockers": preview["blockers"]})
    if not isinstance(token, str) or not token:
        raise ValidationError({"confirmation_token": "Review the deletion preview before confirming."})
    try:
        reviewed = signing.loads(token, salt=SALT, max_age=900)
    except signing.BadSignature:
        raise Conflict("The deletion preview expired or is invalid. Review it again before deleting.")
    if reviewed != payload:
        raise Conflict("This record or its related entries changed after your preview. Review the latest deletion details.")
    try:
        for record in records:
            AuditEvent.objects.create(actor=user, actor_name=str(user), resource=record._meta.model_name,
                                      object_id=record.pk, action="deleted", before=snapshot(record),
                                      after={"deleted": True, "label": record_label(record)})
            record.delete()
    except ProtectedError:
        raise Conflict("Another record now refers to this entry. Refresh and review its links before deleting.")
