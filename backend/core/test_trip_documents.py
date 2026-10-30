from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from directory.models import Client, Partner
from documents.models import Document, DocumentLink
from fleet.models import Vehicle
from orders.models import Order, Stop
from trips.models import Handover, Leg, Trip, Visit


class TripDocumentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("paperwork@example.test", "Disposable-Test-724!")
        cls.trip = Trip.objects.create(dispatcher=cls.user)
        cls.other_trip = Trip.objects.create(dispatcher=cls.user)
        cls.order = Order.objects.create(dispatcher=cls.user)
        cls.other_order = Order.objects.create(dispatcher=cls.user)
        cls.leg = Leg.objects.create(trip=cls.trip, order=cls.order)
        cls.stop = Stop.objects.create(order=cls.order, kind="collection", short_code="IT16")
        cls.visit = Visit.objects.create(trip=cls.trip, short_code="IT16")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def document(self, title, *links):
        document = Document.objects.create(title=title)
        for resource, target in links:
            DocumentLink.objects.create(document=document, resource=resource, object_id=target.pk)
        return document

    def documents(self, trip=None, **filters):
        response = self.api.get("/api/documents/", {"trip": (trip or self.trip).pk, **filters})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_combines_paperwork_once_and_excludes_unrelated_profiles_and_trips(self):
        expected = [
            self.document("Trip", ("trips", self.trip)),
            self.document("Visit CMR", ("visits", self.visit)),
            self.document("Goods", ("orders", self.order)),
            self.document("Stop", ("stops", self.stop)),
            self.document("Leg", ("legs", self.leg)),
            self.document("Linked twice", ("trips", self.trip), ("visits", self.visit), ("orders", self.order)),
        ]
        self.document("Other trip", ("trips", self.other_trip))
        self.document("Other order", ("orders", self.other_order))
        self.document("Unlinked")
        van = Vehicle.objects.create(registration="DOCS", default_rate="0.4")
        partner = Partner.objects.create(name="Partner")
        self.trip.vehicle, self.trip.partner = van, partner
        self.trip.save()
        self.document("Van insurance", ("vehicles", van))
        self.document("Partner papers", ("partners", partner))
        result = self.documents()
        self.assertEqual(result["count"], len(expected))
        self.assertCountEqual([row["id"] for row in result["results"]], [document.pk for document in expected])
        # Existing exact-link filtering remains usable for visit attachments.
        result = self.documents(linked_resource="visits", linked_id=self.visit.pk)
        self.assertEqual(result["count"], 2)

    def test_handover_papers_follow_both_trips_but_visit_files_stay_with_their_visit(self):
        to_leg = Leg.objects.create(trip=self.other_trip, order=self.order, sequence=2)
        handover = Handover.objects.create(order=self.order, from_leg=self.leg, to_leg=to_leg,
                                          location="Depot", occurred_at=timezone.now(), reason="Breakdown")
        paper = self.document("Handover", ("handovers", handover))
        self.document("Original visit", ("visits", self.visit))
        self.assertEqual(self.documents()["count"], 2)
        result = self.documents(self.other_trip)
        self.assertEqual([row["id"] for row in result["results"]], [paper.pk])

    def test_released_order_paperwork_is_not_added_to_trip(self):
        self.document("Order", ("orders", self.order))
        self.document("Actual visit", ("visits", self.visit))
        self.leg.is_cancelled = True
        self.leg.save()
        self.assertEqual(self.documents()["count"], 1)

    def test_invalid_trip_id_and_anonymous_access(self):
        self.assertEqual(self.api.get("/api/documents/?trip=invalid").status_code, 400)
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get(f"/api/documents/?trip={self.trip.pk}").status_code, 403)
