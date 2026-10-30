from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent
from directory.models import Client
from fleet.models import Vehicle
from orders.models import Order, Stop
from trips.models import Attempt, Trip, Visit


class ShipmentCompletionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("completion@example.test", "Correct-Horse-724!", full_name="Dispatcher")
        cls.client_record = Client.objects.create(name="Completion client", country="RO")
        cls.van = Vehicle.objects.create(registration="COMPLETION", registration_country="RO", default_rate="0.4")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def booking(self, **values):
        response = self.api.post("/api/orders/quick-entry/", {"vehicle": self.van.pk, "client": self.client_record.pk, "starting_code": "IT10", "price": "650", "estimated_km": "1280", "cargo_description": "Pallets", "route": [{"kind": "collection", "short_code": "IT16"}, {"kind": "delivery", "short_code": "HU10"}], **values}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(pk=response.data["id"])
        response = self.api.post(f"/api/orders/{order.pk}/command/", {"version": order.version, "action": "confirm"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        order.refresh_from_db()
        return order

    def preview(self, order):
        response = self.api.get(f"/api/orders/{order.pk}/completion-preview/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def complete(self, order, preview=None, expected=200, **values):
        preview = preview or self.preview(order)
        response = self.api.post(f"/api/orders/{order.pk}/command/", {"action": "complete", "version": preview["version"], "confirmation_token": preview["confirmation_token"], "confirm_delivery": True, **values}, format="json")
        self.assertEqual(response.status_code, expected, response.data)
        return response

    def test_confirmed_shipment_completes_directly_without_route_tracking(self):
        order = self.booking()
        trip = order.legs.get().trip
        response = self.complete(order, note="Driver confirmed unloading")
        self.assertEqual(response.data["status"], "delivered")
        self.assertTrue(all(stop.status == "completed" for stop in order.stops.all()))
        self.assertFalse(Attempt.objects.filter(is_current=True).exists())
        self.assertTrue(all(attempt.status == "completed" for attempt in Attempt.objects.all()))
        self.assertTrue(all(visit.status == "departed" for visit in Visit.objects.all()))
        self.assertTrue(all(visit.arrived_at is None and visit.departed_at is None for visit in Visit.objects.all()))
        trip.refresh_from_db()
        self.assertEqual(trip.status, "planned")
        self.assertIsNone(trip.actual_km)
        self.assertEqual(trip.rate, Decimal(str(self.van.default_rate)))
        event = AuditEvent.objects.get(resource="order", object_id=order.pk, action="order_completed_manually")
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.after["completion_note"], "Driver confirmed unloading")
        self.assertEqual(event.before["status"], "confirmed")

    def test_shared_trip_and_other_order_remain_open(self):
        first = self.booking()
        trip = first.legs.get().trip
        second = self.booking(trip=trip.pk, trip_version=trip.version)
        first_collection = Attempt.objects.get(stop__order=first, stop__kind="collection")
        second_collection = Attempt.objects.get(stop__order=second, stop__kind="collection")
        second_collection.visit = first_collection.visit
        second_collection.save()
        self.complete(first)
        second.refresh_from_db()
        first_collection.visit.refresh_from_db()
        self.assertEqual(second.status, "confirmed")
        self.assertTrue(all(stop.status == "planned" for stop in second.stops.all()))
        self.assertEqual(first_collection.visit.status, "planned")
        self.assertTrue(Attempt.objects.get(pk=second_collection.pk).is_current)
        trip.refresh_from_db()
        self.assertEqual(trip.status, "planned")
        self.assertEqual(trip.legs.count(), 2)

    def test_confirmation_and_signed_review_are_required(self):
        order = self.booking()
        self.complete(order, expected=400, confirm_delivery=False)
        self.complete(order, expected=400, confirmation_token="")
        self.complete(order, expected=409, confirmation_token="tampered")
        self.assertFalse(AuditEvent.objects.filter(action="order_completed_manually").exists())
        order.refresh_from_db()
        self.assertEqual(order.status, "confirmed")

    def test_changed_stop_requires_a_fresh_review(self):
        order = self.booking()
        preview = self.preview(order)
        stop = order.stops.first()
        stop.version += 1
        stop.address = "Corrected address"
        stop.save()
        self.complete(order, preview, expected=409)
        self.assertFalse(order.stops.filter(status="completed").exists())
        self.complete(order)

    def test_new_stop_or_changed_visit_invalidates_review(self):
        order = self.booking()
        preview = self.preview(order)
        Stop.objects.create(order=order, kind="collection", short_code="IT16", position=3)
        self.complete(order, preview, expected=409)
        preview = self.preview(order)
        visit = Visit.objects.first()
        visit.version += 1
        visit.save()
        self.complete(order, preview, expected=409)
        response = self.complete(order)
        self.assertEqual(response.data["status"], "delivered")
        self.assertEqual(order.stops.count(), 3)

    def test_returns_and_closed_or_draft_orders_cannot_be_delivered(self):
        for status in ["draft", "delivered", "cancelled"]:
            order = Order.objects.create(dispatcher=self.user, status=status)
            with self.subTest(status=status):
                self.assertFalse(self.preview(order)["allowed"])
                self.complete(order, expected=400)
        order = self.booking()
        order.return_pending = True
        order.status = "in_progress"
        order.save()
        self.assertFalse(self.preview(order)["allowed"])
        self.complete(order, expected=400)

    def test_recorded_stop_times_and_previous_failures_are_preserved(self):
        order = self.booking()
        attempt = Attempt.objects.get(stop__order=order, stop__kind="collection")
        known_time = timezone.now()
        attempt.status = "unsuccessful"
        attempt.is_current = False
        attempt.reason = "Previous attempt failed"
        attempt.save()
        attempt.stop.status = "unsuccessful"
        attempt.stop.save()
        attempt.visit.status = "arrived"
        attempt.visit.arrived_at = known_time
        attempt.visit.save()
        self.complete(order)
        attempt.refresh_from_db()
        attempt.visit.refresh_from_db()
        self.assertEqual(attempt.status, "unsuccessful")
        self.assertEqual(attempt.reason, "Previous attempt failed")
        self.assertEqual(attempt.visit.arrived_at, known_time)
        self.assertIsNone(attempt.visit.departed_at)

    def test_unassigned_shipment_does_not_get_invented_trip_or_visit_records(self):
        order = Order.objects.create(dispatcher=self.user, status="confirmed", price="650")
        Stop.objects.create(order=order, kind="collection", short_code="IT16")
        Stop.objects.create(order=order, kind="delivery", short_code="HU10")
        self.complete(order)
        self.assertFalse(Trip.objects.exists())
        self.assertFalse(Visit.objects.exists())
        self.assertFalse(Attempt.objects.exists())

    def test_completion_does_not_allow_trip_to_be_cancelled_as_untravelled(self):
        order = self.booking()
        self.complete(order)
        trip = order.legs.get().trip
        response = self.api.post(f"/api/trips/{trip.pk}/command/", {"version": trip.version, "action": "cancel", "reason": "Mistake"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        trip.refresh_from_db()
        self.assertIsNone(trip.actual_km)

    def test_missing_required_stops_and_anonymous_access_are_blocked(self):
        order = Order.objects.create(dispatcher=self.user, status="confirmed")
        self.assertFalse(self.preview(order)["allowed"])
        self.complete(order, expected=400)
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get(f"/api/orders/{order.pk}/completion-preview/").status_code, 403)
