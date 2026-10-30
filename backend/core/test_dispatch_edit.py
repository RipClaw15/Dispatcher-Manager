from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent
from directory.models import Partner
from fleet.models import Driver, Vehicle
from orders.models import Order, Stop
from trips.models import Attempt, Leg, Trip


class DispatchEditingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("edit-dispatch@example.test", "Correct-Horse-724!", full_name="Dispatcher")
        cls.van = Vehicle.objects.create(registration="ORIGINAL", registration_country="RO", default_rate="0.4")
        cls.other_van = Vehicle.objects.create(registration="CORRECTED", registration_country="RO", default_rate="0.48")
        cls.driver = Driver.objects.create(full_name="Assigned driver", phone="123")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def booking(self, **values):
        response = self.api.post("/api/orders/quick-entry/", {"vehicle": self.van.pk, "starting_code": "FR95", "price": "650", "estimated_km": "1280", "route": [{"kind": "collection", "short_code": "FR93"}, {"kind": "delivery", "short_code": "SL42"}], **values}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Order.objects.get(pk=response.data["id"])

    def context(self, order):
        response = self.api.get(f"/api/orders/{order.pk}/dispatch-details/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def edit(self, order, expected=200, context=None, **values):
        context = context or self.context(order)
        trip = context["trips"][-1] if context["trips"] else None
        response = self.api.post(f"/api/orders/{order.pk}/dispatch-details/", {"version": context["version"], "trip": trip["id"] if trip else None, **({"trip_version": trip["version"]} if trip else {}), **values}, format="json")
        self.assertEqual(response.status_code, expected, response.data)
        return response

    def test_existing_order_corrects_van_driver_and_origin_without_repricing(self):
        order = self.booking()
        trip = order.legs.get().trip
        response = self.edit(order, vehicle=self.other_van.pk, driver=self.driver.pk, starting_code="FR80")
        self.assertEqual(Trip.objects.count(), 1)
        self.assertEqual(order.legs.count(), 1)
        trip.refresh_from_db()
        self.assertEqual(trip.vehicle, self.other_van)
        self.assertEqual(trip.driver, self.driver)
        self.assertEqual(trip.rate, Decimal("0.4"))
        self.assertEqual(trip.estimated_km, Decimal("1280"))
        summary = response.data["dispatch_summary"]
        self.assertEqual(summary["route_label"], "FR80 → FR93 → SL42")
        self.assertEqual(summary["driver_label"], "Assigned driver")
        self.assertEqual(Decimal(summary["margin"]), Decimal("138"))
        self.assertEqual(order.stops.count(), 2)
        event = AuditEvent.objects.get(resource="trip", object_id=trip.pk, action="dispatch_details_updated")
        self.assertEqual(event.before["vehicle"], self.van.pk)
        self.assertEqual(event.after["vehicle"], self.other_van.pk)

    def test_shared_trip_preview_and_updates_cover_all_linked_orders(self):
        first = self.booking()
        trip = first.legs.get().trip
        second = self.booking(trip=trip.pk, trip_version=trip.version)
        context = self.context(first)
        self.assertCountEqual(context["trips"][0]["order_references"], [first.reference, second.reference])
        self.edit(first, driver=self.driver.pk, starting_code="FR80")
        for order in [first, second]:
            summary = self.api.get(f"/api/orders/{order.pk}/").data["dispatch_summary"]
            self.assertEqual(summary["driver_label"], "Assigned driver")
            self.assertTrue(summary["route_label"].startswith("FR80 →"))
            self.assertEqual(summary["trip_id"], trip.pk)

    def test_unassigned_existing_order_can_receive_a_planned_assignment(self):
        order = Order.objects.create(dispatcher=self.user)
        stop = Stop.objects.create(order=order, kind="collection", short_code="FR93")
        self.assertEqual(self.context(order)["trips"], [])
        response = self.edit(order, vehicle=self.van.pk, driver=self.driver.pk, starting_code="FR95")
        self.assertEqual(Trip.objects.count(), 1)
        self.assertEqual(order.legs.count(), 1)
        self.assertEqual(Attempt.objects.get(stop=stop).visit.trip_id, response.data["dispatch_summary"]["trip_id"])
        self.assertEqual(Order.objects.count(), 1)

    def test_stale_order_and_trip_versions_preserve_newer_changes(self):
        order = self.booking()
        context = self.context(order)
        trip = order.legs.get().trip
        trip.version += 1
        trip.notes = "Other dispatcher edited this"
        trip.save()
        self.edit(order, expected=409, context=context, starting_code="WRONG")
        trip.refresh_from_db()
        self.assertEqual(trip.starting_code, "FR95")
        self.assertEqual(trip.notes, "Other dispatcher edited this")
        context = self.context(order)
        self.edit(order, context=context, starting_code="FR80")
        self.edit(order, expected=409, context=context, starting_code="WRONG")
        trip.refresh_from_db()
        self.assertEqual(trip.starting_code, "FR80")

    def test_trip_must_belong_to_order_and_mismatched_partners_roll_back(self):
        order = self.booking()
        unrelated = Trip.objects.create(dispatcher=self.user)
        self.edit(order, expected=400, trip=unrelated.pk, trip_version=unrelated.version, starting_code="WRONG")
        supplier = Partner.objects.create(name="Supplier", country="RO")
        other = Partner.objects.create(name="Other supplier", country="RO")
        self.other_van.partner = supplier
        self.other_van.save()
        self.driver.partner = other
        self.driver.save()
        self.edit(order, expected=400, vehicle=self.other_van.pk, driver=self.driver.pk, starting_code="WRONG")
        trip = order.legs.get().trip
        self.assertEqual(trip.vehicle, self.van)
        self.assertEqual(trip.starting_code, "FR95")
        self.assertIsNone(trip.driver)

    def test_completed_assignment_correction_does_not_reopen_work_or_change_costs(self):
        order = self.booking()
        trip = order.legs.get().trip
        order.status = "delivered"
        order.save()
        trip.status = "finished"
        trip.actual_km = Decimal("1280")
        trip.save()
        self.edit(order, vehicle=self.other_van.pk, driver=self.driver.pk, starting_code="FR80")
        order.refresh_from_db()
        trip.refresh_from_db()
        self.assertEqual(order.status, "delivered")
        self.assertEqual(trip.status, "finished")
        self.assertEqual(trip.actual_km, Decimal("1280"))
        self.assertEqual(trip.rate, Decimal("0.4"))

    def test_order_with_handover_history_can_choose_which_trip_to_correct(self):
        order = self.booking()
        original = order.legs.get()
        from django.utils import timezone
        original.ended_at = timezone.now()
        original.save()
        later = Trip.objects.create(dispatcher=self.user, starting_code="NEXT")
        Leg.objects.create(order=order, trip=later, sequence=2)
        context = self.context(order)
        self.assertEqual(len(context["trips"]), 2)
        self.edit(order, trip=original.trip_id, trip_version=original.trip.version, starting_code="CORRECTED")
        later.refresh_from_db()
        original.trip.refresh_from_db()
        self.assertEqual(original.trip.starting_code, "CORRECTED")
        self.assertEqual(later.starting_code, "NEXT")

    def test_duplicate_trip_creation_and_anonymous_changes_are_blocked(self):
        order = self.booking()
        self.edit(order, expected=400, trip=None)
        self.assertEqual(Trip.objects.count(), 1)
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get(f"/api/orders/{order.pk}/dispatch-details/").status_code, 403)
