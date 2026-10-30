"""Dispatcher-confirmed shipment completion without replaying route tracking."""
from django.core import signing
from rest_framework.exceptions import ValidationError

from core.models import AuditEvent
from core.workflows import Conflict, change, snapshot
from trips.models import Attempt, Visit

SALT = "dispatch.shipment-completion.v1"


def completion_preview(order, user):
    stops = list(order.stops.order_by("position", "pk"))
    attempts = list(Attempt.objects.filter(stop__order=order, is_current=True).select_related("visit").order_by("pk"))
    visits = list(Visit.objects.filter(attempts__stop__order=order, kind="work").distinct().order_by("pk"))
    required = [stop for stop in stops if stop.kind in {"collection", "delivery"} and stop.status != "cancelled"]
    blockers = []
    if order.status not in {"confirmed", "in_progress"}:
        blockers.append("Only confirmed or in-progress shipments can be marked completed.")
    if order.return_pending or any(stop.kind == "return" and stop.status != "cancelled" for stop in stops):
        blockers.append("This shipment is awaiting a return to the loading point. Complete the return workflow instead.")
    if not any(stop.kind == "collection" for stop in required) or not any(stop.kind == "delivery" for stop in required):
        blockers.append("Add at least one collection and one delivery before completing the shipment.")
    payload = {"user": user.pk, "order": [order.pk, order.version],
               "stops": [[stop.pk, stop.version] for stop in stops],
               "attempts": [[attempt.pk, attempt.version, attempt.visit_id] for attempt in attempts],
               "visits": [[visit.pk, visit.version] for visit in visits],
               "legs": [[leg_id, version] for leg_id, version in order.legs.order_by("pk").values_list("pk", "version")]}
    return {"allowed": not blockers, "blockers": blockers, "version": order.version,
            "stops": [{"id": stop.pk, "kind": stop.kind, "label": str(stop),
                       "detail": stop.location_name or stop.address, "status": stop.status} for stop in required],
            "confirmation_token": signing.dumps(payload, salt=SALT) if not blockers else None}, payload


def complete_order(order, data, user):
    preview, payload = completion_preview(order, user)
    if not preview["allowed"]:
        raise ValidationError({"detail": preview["blockers"]})
    if data.get("confirm_delivery") is not True:
        raise ValidationError({"confirm_delivery": "Confirm that all goods have been collected and delivered."})
    token = data.get("confirmation_token")
    if not isinstance(token, str) or not token:
        raise ValidationError({"confirmation_token": "Review the shipment before confirming completion."})
    try:
        reviewed = signing.loads(token, salt=SALT, max_age=900)
    except signing.BadSignature:
        raise Conflict("The completion preview expired or is invalid. Review the shipment again.")
    if reviewed != payload:
        raise Conflict("The shipment or its stops changed after your review. Review the latest information before completing it.")
    note = data.get("note", "")
    if not isinstance(note, str) or len(note) > 4000:
        raise ValidationError({"note": "Use a completion note of up to 4,000 characters."})
    note = note.strip()
    stops = order.stops.filter(kind__in=["collection", "delivery"]).exclude(status="cancelled")
    for stop in stops:
        for attempt in stop.attempts.filter(is_current=True):
            # The dispatcher confirms the outcome, not precise historic stop
            # timings. Preserve actual arrival/departure times already entered.
            change(attempt, user, "attempt_completed_by_shipment_confirmation", status="completed",
                   is_current=False, reason=note or "Shipment completion confirmed by dispatcher")
        if stop.status != "completed":
            change(stop, user, "stop_completed_by_shipment_confirmation", status="completed",
                   reason=note or "Shipment completion confirmed by dispatcher")
    for visit in Visit.objects.filter(attempts__stop__order=order, kind="work").distinct():
        if visit.status not in {"departed", "cancelled"} and not visit.attempts.filter(is_current=True).exists():
            change(visit, user, "visit_closed_by_shipment_confirmation", status="departed")
    before = snapshot(order)
    order.status = "delivered"
    order.version += 1
    order.save()
    AuditEvent.objects.create(actor=user, actor_name=str(user), resource="order", object_id=order.pk,
                              action="order_completed_manually", before=before,
                              after={**snapshot(order), "completion_note": note,
                                     "completion_method": "Dispatcher confirmed collection and delivery"})
