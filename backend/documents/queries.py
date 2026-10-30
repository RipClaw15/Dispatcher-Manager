"""Find trip paperwork without duplicating files or adding extra links."""
from django.db.models import Q

from documents.models import DocumentLink
from orders.models import Stop
from trips.models import Handover, Leg, Visit


def trip_document_ids(trip_id):
    legs = Leg.objects.filter(trip_id=trip_id)
    order_ids = legs.filter(is_cancelled=False).values("order_id")
    links = (
        Q(resource="trips", object_id=trip_id)
        | Q(resource="visits", object_id__in=Visit.objects.filter(trip_id=trip_id).values("pk"))
        | Q(resource="legs", object_id__in=legs.values("pk"))
        | Q(resource="orders", object_id__in=order_ids)
        | Q(resource="stops", object_id__in=Stop.objects.filter(order_id__in=order_ids).values("pk"))
        | Q(resource="handovers", object_id__in=Handover.objects.filter(
            Q(from_leg__trip_id=trip_id) | Q(to_leg__trip_id=trip_id)
        ).values("pk"))
    )
    return DocumentLink.objects.filter(links).values("document_id")
