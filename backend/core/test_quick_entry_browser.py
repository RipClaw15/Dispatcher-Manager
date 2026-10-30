"""Opt-in browser flow against Django's disposable test database, never dev data."""
import os
import subprocess
from tempfile import TemporaryDirectory
from datetime import date
from unittest.mock import patch
from unittest import skipUnless

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import LiveServerTestCase, override_settings

from accounts.models import User
from directory.models import Client, Country, Partner
from documents.models import Document, DocumentLink, DocumentVersion
from fleet.models import Driver, Vehicle
from orders.models import Cargo, Order, Stop
from trips.models import Attempt, Leg, Trip, Visit
from core.test_postcodes import archive
from directory.postcodes import import_archive
from directory.eurostat_postcodes import import_eurostat_csv
import csv


@skipUnless(os.getenv("RUN_QUICK_BROWSER") == "1", "Opt-in: requires the local Vite server and installed Edge.")
class QuickEntryBrowserTests(LiveServerTestCase):
    def test_quick_entry_from_browser_to_database(self):
        password = "Disposable-Quick-Test-724!"
        user = User.objects.create_user("quick-browser@example.test", password, full_name="Test Dispatcher")
        client = Client.objects.create(name="Lukstransa", country="LT")
        van = Vehicle.objects.create(registration="HD-86-GMC", registration_country="RO", default_rate="0.4")
        other_van = Vehicle.objects.create(registration="HD-99-EDIT", registration_country="RO", default_rate="0.48")
        driver = Driver.objects.create(full_name="Assigned Driver", phone="123", citizenship="RO")
        result = subprocess.run(["node", "frontend/tests/quick_entry_flow.cjs"], cwd=settings.BASE_DIR.parent,
                                env={**os.environ, "QUICK_TEST_API": self.live_server_url,
                                     "QUICK_TEST_EMAIL": user.email, "QUICK_TEST_PASSWORD": password,
                                     "QUICK_TEST_VAN": str(van.pk), "QUICK_TEST_CLIENT": str(client.pk),
                                     "QUICK_TEST_OTHER_VAN": str(other_van.pk), "QUICK_TEST_DRIVER": str(driver.pk)},
                                text=True, capture_output=True, timeout=150)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(Order.objects.count(), 2)
        self.assertEqual(Trip.objects.count(), 1)
        self.assertEqual(Trip.objects.get().estimated_km, 1300)
        self.assertEqual(Trip.objects.get().legs.count(), 2)
        self.assertEqual(Trip.objects.get().driver_id, driver.pk)
        self.assertEqual(Trip.objects.get().vehicle_id, van.pk)
        driver.refresh_from_db()
        self.assertEqual(driver.citizenship, "HU")
        self.assertTrue(Country.objects.filter(name="Browser custom country", is_custom=True).exists())
        self.assertEqual(Order.objects.filter(status="delivered").count(), 1)
        self.assertEqual(Order.objects.filter(status="draft").count(), 1)


@skipUnless(os.getenv("RUN_QUICK_BROWSER") == "1", "Opt-in: requires the local Vite server and installed Edge.")
class VisitDocumentsBrowserTests(LiveServerTestCase):
    def test_visit_documents_and_in_place_progress(self):
        password = "Disposable-Visit-Test-724!"
        user = User.objects.create_user("visit-browser@example.test", password, full_name="Test Dispatcher")
        client = Client.objects.create(name="Paperwork client")
        partner = Partner.objects.create(name="Paperwork carrier")
        van = Vehicle.objects.create(registration="VISIT-DOCS", default_rate="0.4")
        driver = Driver.objects.create(full_name="Paperwork driver")
        order = Order.objects.create(dispatcher=user, client=client, status="confirmed", price="650")
        collection = Stop.objects.create(order=order, kind="collection", short_code="IT16", position=1)
        delivery = Stop.objects.create(order=order, kind="delivery", short_code="HU10", position=2)
        Cargo.objects.create(order=order, collection=collection, delivery=delivery, description="Pallets")
        trip = Trip.objects.create(dispatcher=user, partner=partner, vehicle=van, driver=driver, rate="0.4", estimated_km="1000")
        Leg.objects.create(trip=trip, order=order)
        loading = Visit.objects.create(trip=trip, short_code="IT16", position=1)
        customs = Visit.objects.create(trip=trip, kind="customs", short_code="Customs depot", position=2)
        customs.orders.add(order)
        unloading = Visit.objects.create(trip=trip, short_code="HU10", position=3)
        handover = Visit.objects.create(trip=trip, kind="handover", short_code="Transfer depot", position=4)
        Attempt.objects.create(stop=collection, visit=loading)
        Attempt.objects.create(stop=delivery, visit=unloading)
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            for title, resource, target in [("Agreed order", "orders", order), ("Trip paperwork", "trips", trip)]:
                document = Document.objects.create(title=title)
                DocumentLink.objects.create(document=document, resource=resource, object_id=target.pk)
                DocumentVersion.objects.create(document=document, uploaded_by=user, original_name=f"{title}.pdf",
                                               file=SimpleUploadedFile(f"{title}.pdf", b"%PDF-1.4 fixture"))
            result = subprocess.run(["node", "frontend/tests/visit_documents_flow.cjs"], cwd=settings.BASE_DIR.parent,
                                    env={**os.environ, "VISIT_TEST_API": self.live_server_url,
                                         "VISIT_TEST_EMAIL": user.email, "VISIT_TEST_PASSWORD": password,
                                         "VISIT_TEST_TRIP": str(trip.pk), "VISIT_TEST_ORDER": str(order.pk),
                                         "VISIT_TEST_LOADING": str(loading.pk), "VISIT_TEST_UNLOADING": str(unloading.pk),
                                         "VISIT_TEST_CUSTOMS": str(customs.pk), "VISIT_TEST_HANDOVER": str(handover.pk)},
                                    text=True, capture_output=True, timeout=150)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(Document.objects.count(), 5)
            self.assertEqual(DocumentVersion.objects.count(), 5)
            self.assertEqual(DocumentLink.objects.filter(resource="visits").count(), 3)
            loading.refresh_from_db()
            delivery.refresh_from_db()
            order.refresh_from_db()
            self.assertEqual(loading.status, "departed")
            self.assertIsNotNone(loading.arrived_at)
            self.assertIsNotNone(loading.departed_at)
            self.assertEqual(delivery.status, "completed")
            self.assertEqual(order.status, "delivered")
            self.assertTrue(all(visit.status == "departed" for visit in trip.visits.all()))


@skipUnless(os.getenv("RUN_QUICK_BROWSER") == "1", "Opt-in: requires the local Vite server and installed Edge.")
class ShipmentNotebookBrowserTests(LiveServerTestCase):
    def test_latest_recorded_month_and_today_shortcut(self):
        password = "Disposable-Notebook-Test-724!"
        user = User.objects.create_user("latest-browser@example.test", password, full_name="Notebook Dispatcher")
        for when, status in [("2024-06-01", "draft"), ("2024-06-18", "draft"), ("2024-05-31", "confirmed")]:
            order = Order.objects.create(dispatcher=user, status=status)
            Stop.objects.create(order=order, kind="collection", planned_date=when, short_code="IT16")
        with patch("orders.notebook.timezone.localdate", return_value=date(2026, 10, 30)):
            result = subprocess.run(["node", "frontend/tests/notebook_flow.cjs"], cwd=settings.BASE_DIR.parent,
                                    env={**os.environ, "NOTEBOOK_TEST_API": self.live_server_url,
                                         "NOTEBOOK_TEST_EMAIL": user.email, "NOTEBOOK_TEST_PASSWORD": password,
                                         "NOTEBOOK_TEST_LATEST_MONTH": "1"},
                                    text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_monthly_notebook_filters_pagination_and_loading_date_edits(self):
        password = "Disposable-Notebook-Test-724!"
        user = User.objects.create_user("notebook-browser@example.test", password, full_name="Notebook Dispatcher")
        client = Client.objects.create(name="Lukstransa")
        other_client = Client.objects.create(name="RJP")
        van = Vehicle.objects.create(registration="HD-86-GMC", default_rate="0.4")
        other_van = Vehicle.objects.create(registration="AB-42-GAM", default_rate="0.48")
        trips = {vehicle.pk: Trip.objects.create(dispatcher=user, vehicle=vehicle, rate=vehicle.default_rate, estimated_km=1280) for vehicle in [van, other_van]}
        for code, name in [("IT", "Italy"), ("HU", "Hungary"), ("RO", "Romania"), ("CZ", "Czechia"), ("MA", "Morocco")]:
            Country.objects.get_or_create(code=code, defaults={"name": name})

        def booking(when, customer=client, vehicle=None, status="draft", loading="IT16", delivery="HU10", price="650"):
            order = Order.objects.create(dispatcher=user, client=customer, date_received="2026-10-30", price=price, status=status)
            Stop.objects.create(order=order, kind="collection", short_code=loading, planned_date=when,
                                timing="date" if when else "unknown", position=1)
            Stop.objects.create(order=order, kind="delivery", short_code=delivery, position=2)
            if vehicle:
                Leg.objects.create(order=order, trip=trips[vehicle.pk])
            return order

        today = booking("2026-10-30", vehicle=van, status="confirmed")
        booking("2026-10-30", customer=other_client, vehicle=other_van, loading="RO40", delivery="CZ29", price="400")
        booking("2026-10-29", vehicle=van, price="550")
        booking("2026-10-01", loading="MA10", price="200")
        booking("2026-10-31", vehicle=van, price="250")
        booking("2026-09-30")
        for _ in range(101):
            booking("2026-09-01", price="100")
        undated = booking(None)
        no_stop = Order.objects.create(dispatcher=user)
        with patch("orders.notebook.timezone.localdate", return_value=date(2026, 10, 30)):
            result = subprocess.run(["node", "frontend/tests/notebook_flow.cjs"], cwd=settings.BASE_DIR.parent,
                                    env={**os.environ, "NOTEBOOK_TEST_API": self.live_server_url,
                                         "NOTEBOOK_TEST_EMAIL": user.email, "NOTEBOOK_TEST_PASSWORD": password,
                                         "NOTEBOOK_TEST_VAN": str(van.pk), "NOTEBOOK_TEST_CLIENT": str(client.pk),
                                         "NOTEBOOK_TEST_OTHER_CLIENT": str(other_client.pk),
                                         "NOTEBOOK_TEST_TODAY": str(today.pk), "NOTEBOOK_TEST_UNDATED": str(undated.pk),
                                         "NOTEBOOK_TEST_NO_STOP": str(no_stop.pk)},
                                    text=True, capture_output=True, timeout=150)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(undated.stops.get(kind="collection").planned_date, date(2026, 10, 29))
        self.assertFalse(no_stop.stops.exists())


@skipUnless(os.getenv("RUN_QUICK_BROWSER") == "1", "Opt-in: requires the local Vite server and installed Edge.")
class ZPostcodeLookupBrowserTests(LiveServerTestCase):
    def test_local_postcodes_in_quick_entry_and_stop_editing(self):
        password = "Disposable-Postcode-Test-724!"
        user = User.objects.create_user("postcode-browser@example.test", password, full_name="Postcode Dispatcher")
        for code, name in [("HU", "Hungary"), ("GB-SCT", "Scotland"), ("MA", "Morocco")]:
            Country.objects.get_or_create(code=code, defaults={"name": name})
        with TemporaryDirectory() as directory:
            from pathlib import Path
            source = Path(directory) / "eurostat.csv"
            with source.open("w", encoding="utf-8", newline="") as output:
                writer = csv.writer(output)
                writer.writerow(["CNTR_ID", "POSTCODE", "LAU_NAME"])
                writer.writerows([["HU", "1117", "Budapest"], ["HU", "1138", "Budapest"], ["HU", "9021", "Győr"]])
            import_eurostat_csv(source, countries={"HU"})
        import_archive("GB", archive("GB", [("EH1", "Edinburgh", "Scotland"), ("SW1A", "London", "England")]))
        order = Order.objects.create(dispatcher=user)
        stop = Stop.objects.create(order=order, kind="collection", country="HU", short_code="HU11", address="Dispatcher street", position=1)
        result = subprocess.run(["node", "frontend/tests/postcodes_flow.cjs"], cwd=settings.BASE_DIR.parent,
                                env={**os.environ, "POSTCODE_TEST_API": self.live_server_url,
                                     "POSTCODE_TEST_EMAIL": user.email, "POSTCODE_TEST_PASSWORD": password,
                                     "POSTCODE_TEST_ORDER": str(order.pk)},
                                text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        stop.refresh_from_db()
        self.assertEqual(stop.city, "Budapest")
        self.assertEqual(stop.postal_code, "1138")
        self.assertEqual(stop.short_code, "HU11")
        self.assertEqual(stop.address, "Dispatcher street")
        self.assertEqual(Order.objects.count(), 1)
