from datetime import date
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from directory.models import Client, Country
from fleet.models import Vehicle
from orders.models import Order, Stop
from trips.models import Leg, Trip


class OrderNotebookTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("notebook@example.test", "Disposable-Notebook-724!")
        cls.customer = Client.objects.create(name="Notebook client")
        cls.van = Vehicle.objects.create(registration="NOTEBOOK", default_rate="0.4")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.clock = patch("orders.notebook.timezone.localdate", return_value=date(2026, 10, 30))
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def order(self, loading_date=None, **values):
        order = Order.objects.create(dispatcher=self.user, client=self.customer, date_received="2026-09-01", **values)
        Stop.objects.create(order=order, kind="collection", position=1, short_code="IT16", planned_date=loading_date)
        Stop.objects.create(order=order, kind="delivery", position=2, short_code="HU10")
        return order

    def notebook(self, **params):
        response = self.api.get("/api/orders/notebook/", params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_month_uses_loading_date_and_sorts_days_descending(self):
        first = self.order("2026-10-01")
        today = self.order("2026-10-30")
        yesterday = self.order("2026-10-29")
        upcoming = self.order("2026-10-31")
        september = self.order("2026-09-30")
        self.order("2026-11-01")
        self.order()
        result = self.notebook(month="2026-10")
        self.assertEqual(result["month"], "2026-10")
        self.assertEqual(result["today"], "2026-10-30")
        self.assertEqual(result["undated_count"], 1)
        self.assertEqual(result["upcoming_count"], 1)
        self.assertEqual([row["id"] for row in result["results"]], [upcoming.pk, today.pk, yesterday.pk, first.pk])
        self.assertEqual([row["id"] for row in self.notebook(month="2026-09")["results"]], [september.pk])

    def test_default_month_uses_the_latest_loading_date_not_when_the_order_was_entered(self):
        self.order("2024-05-31")
        latest = self.order("2024-06-18")
        self.order()
        result = self.notebook()
        self.assertEqual(result["month"], "2024-06")
        self.assertEqual([row["id"] for row in result["results"]], [latest.pk])
        self.assertEqual(self.notebook(month="2026-10")["count"], 0)
        future = self.order("2026-11-01")
        self.assertEqual(self.notebook()["results"][0]["id"], future.pk)

    def test_without_dated_shipments_default_month_falls_back_to_today(self):
        self.order()
        result = self.notebook()
        self.assertEqual(result["month"], "2026-10")
        self.assertEqual(result["undated_count"], 1)

    def test_first_collection_means_route_position_not_earliest_known_date(self):
        order = self.order()
        Stop.objects.create(order=order, kind="collection", position=3, planned_date="2026-10-30")
        self.assertEqual(self.notebook()["count"], 0)
        self.assertEqual(self.notebook(scope="undated")["results"][0]["id"], order.pk)
        first = order.stops.get(position=1)
        first.status = "cancelled"
        first.save()
        self.assertEqual(self.notebook()["results"][0]["loading_date"], "2026-10-30")

    def test_filters_combine_van_client_countries_and_status_without_duplicates(self):
        order = self.order("2026-10-30", status="confirmed")
        trip = Trip.objects.create(dispatcher=self.user, vehicle=self.van)
        Leg.objects.create(order=order, trip=trip)
        Leg.objects.create(order=order, trip=trip, sequence=2, ended_at="2026-10-30T10:00:00Z")
        self.order("2026-10-30")
        # Country filters accept a prefix inferred only when country is blank.
        result = self.notebook(vehicle=self.van.pk, client=self.customer.pk, loading_country="IT", delivery_country="HU", status="confirmed")
        self.assertEqual([row["id"] for row in result["results"]], [order.pk])
        collection = order.stops.get(kind="collection")
        collection.country = "France"
        collection.save()
        self.assertEqual(self.notebook(loading_country="IT", vehicle=self.van.pk)["count"], 0)
        self.assertEqual(self.notebook(loading_country="FR", vehicle=self.van.pk)["count"], 1)

    def test_any_collection_and_custom_country_filter_work(self):
        custom = Country.objects.create(name="Notebook custom country", is_custom=True)
        order = self.order("2026-10-30")
        Stop.objects.create(order=order, kind="collection", position=3, country=custom.name)
        self.assertEqual(self.notebook(loading_country=custom.name)["count"], 1)
        self.assertEqual(self.notebook(loading_country="DE")["count"], 0)

    def test_cancelled_bookings_keep_their_original_notebook_day_and_countries(self):
        order = self.order("2026-10-29", status="cancelled")
        order.stops.update(status="cancelled")
        result = self.notebook(status="cancelled", loading_country="IT", delivery_country="HU")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["results"][0]["loading_date"], "2026-10-29")

    def test_unassigned_van_ignores_released_assignments(self):
        order = self.order("2026-10-30")
        trip = Trip.objects.create(dispatcher=self.user, vehicle=self.van)
        Leg.objects.create(order=order, trip=trip, is_cancelled=True)
        Leg.objects.create(order=order, trip=Trip.objects.create(dispatcher=self.user))
        self.assertEqual(self.notebook(vehicle="unassigned")["count"], 1)

    def test_loading_date_edit_moves_order_and_protects_concurrent_stop_changes(self):
        order = self.order()
        path = f"/api/orders/{order.pk}/loading-date/"
        preview = self.api.get(path).data
        body = {"version": preview["version"], "stop": preview["stop"]["id"], "stop_version": preview["stop"]["version"], "planned_date": "2026-10-29"}
        stop = order.stops.get(kind="collection")
        stop.version += 1
        stop.save()
        self.assertEqual(self.api.post(path, body, format="json").status_code, 409)
        body["stop_version"] = stop.version
        response = self.api.post(path, body, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        stop.refresh_from_db()
        self.assertEqual(stop.planned_date, date(2026, 10, 29))
        self.assertEqual(stop.timing, "date")
        self.assertEqual(self.notebook()["count"], 1)
        self.assertEqual(self.notebook(scope="undated")["count"], 0)

    def test_changed_first_stop_and_missing_collection_are_blocked(self):
        order = self.order()
        path = f"/api/orders/{order.pk}/loading-date/"
        preview = self.api.get(path).data
        Stop.objects.create(order=order, kind="collection", position=0)
        body = {"version": preview["version"], "stop": preview["stop"]["id"], "stop_version": preview["stop"]["version"], "planned_date": None}
        self.assertEqual(self.api.post(path, body, format="json").status_code, 409)
        empty = Order.objects.create(dispatcher=self.user)
        self.assertIsNone(self.api.get(f"/api/orders/{empty.pk}/loading-date/").data["stop"])

    def test_corrected_date_keeps_planned_times_and_clearing_explicitly_removes_them(self):
        order = self.order("2026-10-30")
        stop = order.stops.get(kind="collection")
        stop.timing, stop.time_from, stop.time_to = "window", "09:00", "11:00"
        stop.save()
        path = f"/api/orders/{order.pk}/loading-date/"
        for planned_date in ["2026-10-29", None]:
            preview = self.api.get(path).data
            response = self.api.post(path, {"version": preview["version"], "stop": preview["stop"]["id"],
                                            "stop_version": preview["stop"]["version"], "planned_date": planned_date}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            stop.refresh_from_db()
            self.assertEqual(stop.timing, "window" if planned_date else "unknown")
            self.assertEqual(str(stop.time_from), "09:00:00" if planned_date else "None")

    def test_invalid_month_filters_dates_and_anonymous_access(self):
        for month in ["2026-13", "2026-1", "0000-01", "x"]:
            self.assertEqual(self.api.get("/api/orders/notebook/", {"month": month}).status_code, 400)
        self.assertEqual(self.api.get("/api/orders/notebook/?vehicle=invalid").status_code, 400)
        self.assertEqual(self.api.get("/api/orders/notebook/?scope=invalid").status_code, 400)
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get("/api/orders/notebook/").status_code, 403)

    def test_quick_entry_stores_loading_date_on_the_collection_only(self):
        response = self.api.post("/api/orders/quick-entry/", {"route": [
            {"kind": "collection", "short_code": "IT16", "planned_date": "2026-10-30"},
            {"kind": "delivery", "short_code": "HU10"},
        ]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["loading_date"], "2026-10-30")
        self.assertEqual(Stop.objects.get(order_id=response.data["id"], kind="collection").timing, "date")
        self.assertIsNone(Stop.objects.get(order_id=response.data["id"], kind="delivery").planned_date)

    def test_known_loading_date_is_saved_even_before_the_collection_location_is_known(self):
        response = self.api.post("/api/orders/quick-entry/", {"route": [
            {"kind": "collection", "planned_date": "2026-10-30"},
        ]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["loading_date"], "2026-10-30")
        self.assertEqual(response.data["status"], "draft")
