from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent
from directory.models import Client
from fleet.models import Vehicle
from orders.models import Cargo, Order, Stop
from trips.models import Attempt, Leg, Trip, Visit


class QuickEntryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("quick@example.test", "Correct-Horse-724!", full_name="Dispatcher")
        cls.client_record = Client.objects.create(name="Lukstransa", country="LT")
        cls.van = Vehicle.objects.create(registration="HD-86-GMC", registration_country="RO", default_rate="0.4")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def payload(self, **values):
        return {"vehicle": self.van.pk, "client": self.client_record.pk, "starting_code": "FR95", "price": "650", "estimated_km": "1280",
                "route": [{"kind": "collection", "short_code": "FR93"}, {"kind": "delivery", "short_code": "SL42"}], **values}

    def create(self, **values):
        response = self.api.post("/api/orders/quick-entry/", self.payload(**values), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Order.objects.get(pk=response.data["id"]), response.data

    def test_notebook_example_saves_every_link_without_cargo_or_addresses(self):
        order, data = self.create()
        self.assertEqual(order.status, "draft")
        self.assertFalse(order.cargo.exists())
        self.assertEqual(list(order.stops.values_list("kind", "short_code")), [("collection", "FR93"), ("delivery", "SL42")])
        self.assertEqual(Attempt.objects.count(), 2)
        trip = order.legs.get().trip
        self.assertEqual(trip.vehicle, self.van)
        self.assertEqual(trip.starting_code, "FR95")
        self.assertEqual(trip.rate, Decimal("0.4"))
        summary = data["dispatch_summary"]
        self.assertEqual(summary["vehicle_label"], "HD-86-GMC")
        self.assertEqual(summary["route_label"], "FR95 → FR93 → SL42")
        self.assertEqual(Decimal(summary["cost"]), Decimal("512"))
        self.assertEqual(Decimal(summary["margin"]), Decimal("138"))
        self.assertTrue(summary["provisional"])
        self.assertFalse(summary["shared"])

    def test_multiple_collections_deliveries_and_customs_keep_typed_sequence(self):
        points = [{"kind": kind, "short_code": code} for kind, code in [("collection", "FR93"), ("collection", "FR67"), ("customs", "CH-BASEL"), ("delivery", "SL42"), ("customs", "BORDER-2"), ("delivery", "SL10")]]
        order, data = self.create(route=points)
        self.assertTrue(order.customs_required)
        self.assertEqual(order.stops.count(), 4)
        self.assertEqual(order.customs_visits.count(), 2)
        self.assertEqual([point["kind"] for point in data["dispatch_summary"]["route"]], [point["kind"] for point in points])
        self.assertEqual(data["dispatch_summary"]["route_label"], "FR95 → FR93 → FR67 → CH-BASEL → SL42 → BORDER-2 → SL10")
        self.assertEqual(Attempt.objects.count(), 4)

    def test_shared_trip_reuses_van_cost_and_updates_whole_trip_distance_once(self):
        first, _ = self.create(price="550", estimated_km="1000")
        trip = first.legs.get().trip
        second, data = self.create(trip=trip.pk, trip_version=trip.version, price="250", estimated_km="1300", route=[{"kind": "collection", "short_code": "FR94"}, {"kind": "delivery", "short_code": "SL43"}])
        self.assertEqual(Trip.objects.count(), 1)
        trip.refresh_from_db()
        self.assertEqual(trip.legs.count(), 2)
        self.assertEqual(trip.estimated_km, Decimal("1300"))
        summary = data["dispatch_summary"]
        self.assertTrue(summary["shared"])
        self.assertEqual(Decimal(summary["revenue"]), Decimal("800"))
        self.assertEqual(Decimal(summary["cost"]), Decimal("520"))
        self.assertEqual(Decimal(summary["margin"]), Decimal("280"))
        listing = self.api.get("/api/orders/").data["results"]
        self.assertTrue(all(item["dispatch_summary"]["shared"] for item in listing))
        self.assertTrue(all(Decimal(item["dispatch_summary"]["margin"]) == Decimal("280") for item in listing))
        self.assertEqual(len(set(trip.visits.values_list("position", flat=True))), 4)

    def test_minimal_draft_does_not_require_any_profiles_or_trip(self):
        response = self.api.post("/api/orders/quick-entry/", {"route": [{"kind": "collection", "short_code": ""}, {"kind": "delivery", "short_code": ""}]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(pk=response.data["id"])
        self.assertIsNone(order.client)
        self.assertFalse(order.legs.exists())
        self.assertFalse(order.stops.exists())
        self.assertIsNone(response.data["dispatch_summary"]["margin"])
        _, data = self.create(vehicle=None, client=None, price=None)
        self.assertEqual(data["dispatch_summary"]["route_label"], "FR95 → FR93 → SL42")
        self.assertIsNone(data["dispatch_summary"]["margin"])

    def test_confirmation_accepts_short_codes_and_optional_goods_description(self):
        order, _ = self.create(cargo_description="Pallets")
        response = self.api.post(f"/api/orders/{order.pk}/command/", {"version": order.version, "action": "confirm"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "confirmed")
        self.assertTrue(all(not stop.address and not stop.postal_code for stop in order.stops.all()))

    def test_full_location_details_enrich_the_same_short_code_point(self):
        order, _ = self.create()
        stop = order.stops.get(kind="collection")
        response = self.api.patch(f"/api/stops/{stop.pk}/", {"version": stop.version, "address": "12 Warehouse Road", "postal_code": "93100", "location_name": "Warehouse A"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        stop.refresh_from_db()
        self.assertEqual(stop.short_code, "FR93")
        self.assertEqual(stop.postal_code, "93100")
        visit = stop.attempts.get(is_current=True).visit
        self.assertEqual(visit.address, "12 Warehouse Road")
        self.assertEqual(visit.short_code, "FR93")
        self.assertEqual(order.stops.count(), 2)
        self.assertEqual(self.api.get(f"/api/orders/{order.pk}/").data["dispatch_summary"]["route_label"], "FR95 → FR93 → SL42")

    def test_invalid_input_rolls_back_and_stale_shared_trip_is_rejected(self):
        for values in [{"price": "-1"}, {"route": [{"kind": "unknown", "short_code": "X"}]}, {"rate": "0.5", "rate_reason": ""}, {"cargo_description": "Pallets", "route": [{"kind": "collection", "short_code": "A"}]}]:
            with self.subTest(values=values):
                response = self.api.post("/api/orders/quick-entry/", self.payload(**values), format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertFalse(Order.objects.exists())
                self.assertFalse(Trip.objects.exists())
        order, _ = self.create()
        trip = order.legs.get().trip
        response = self.api.post("/api/orders/quick-entry/", self.payload(trip=trip.pk, trip_version=999), format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(trip.legs.count(), 1)

    def test_quick_draft_deletion_cleans_untouched_automatic_plan(self):
        order, _ = self.create()
        preview = self.api.get(f"/api/orders/{order.pk}/delete-preview/").data
        self.assertTrue(preview["allowed"], preview)
        response = self.api.delete(f"/api/orders/{order.pk}/", {"version": preview["version"], "confirmation_token": preview["confirmation_token"]}, format="json")
        self.assertEqual(response.status_code, 204, getattr(response, "data", None))
        for model in [Order, Stop, Cargo, Trip, Leg, Visit, Attempt]:
            self.assertFalse(model.objects.exists(), model.__name__)
        self.assertTrue(Vehicle.objects.filter(pk=self.van.pk).exists())
        self.assertTrue(AuditEvent.objects.filter(action="deleted").exists())

    def test_deleting_shared_quick_draft_keeps_other_order_and_trip(self):
        first, _ = self.create()
        trip = first.legs.get().trip
        second, _ = self.create(trip=trip.pk, trip_version=trip.version)
        preview = self.api.get(f"/api/orders/{second.pk}/delete-preview/").data
        self.assertTrue(preview["allowed"], preview)
        response = self.api.delete(f"/api/orders/{second.pk}/", {"version": preview["version"], "confirmation_token": preview["confirmation_token"]}, format="json")
        self.assertEqual(response.status_code, 204, getattr(response, "data", None))
        self.assertTrue(Order.objects.filter(pk=first.pk).exists())
        self.assertTrue(Trip.objects.filter(pk=trip.pk).exists())
        self.assertEqual(trip.legs.count(), 1)
        self.assertEqual(trip.visits.count(), 2)

    def test_started_trip_prevents_quick_plan_deletion(self):
        order, _ = self.create()
        trip = order.legs.get().trip
        trip.status = "in_progress"
        trip.save()
        preview = self.api.get(f"/api/orders/{order.pk}/delete-preview/").data
        self.assertFalse(preview["allowed"])
        self.assertEqual(Attempt.objects.count(), 2)

    def test_lookup_by_van_client_and_short_route_code(self):
        order, _ = self.create()
        for term in ["HD-86-GMC", "FR95", "FR93", "SL42", "Lukstransa"]:
            with self.subTest(term=term):
                response = self.api.get("/api/orders/", {"q": term})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual([item["id"] for item in response.data["results"]], [order.pk])

    def test_shared_profit_waits_for_all_order_prices(self):
        first, _ = self.create(price=None)
        trip = first.legs.get().trip
        _, data = self.create(trip=trip.pk, trip_version=trip.version, price="250")
        self.assertIsNone(data["dispatch_summary"]["margin"])
        self.assertIsNotNone(data["dispatch_summary"]["cost"])
