from decimal import Decimal
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client as BrowserClient, TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from core.workflows import financials
from directory.models import Client, Partner
from documents.models import Document, DocumentVersion
from fleet.models import Driver, Vehicle
from orders.models import Cargo, Order, Stop
from reviews.models import Review
from trips.models import Attempt, Leg, Trip, Visit


class IndependentEntryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("entry@example.test", "Correct-Horse-724!", full_name="Dispatcher")
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def create(self, resource, **data):
        response = self.api.post(f"/api/{resource}/", data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def patch(self, resource, record, **data):
        response = self.api.patch(f"/api/{resource}/{record['id']}/", {"version": record["version"], **data}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_order_saved_without_client_and_linked_later(self):
        self.assertFalse(Client.objects.exists())
        order = self.create("orders", client=None, dispatcher=None, notes="Awaiting client details")
        self.assertEqual(order["status"], "draft")
        self.assertIsNone(order["client"])
        self.assertEqual(order["dispatcher"], self.user.pk)
        client = Client.objects.create(name="Later client", country="RO")
        linked = self.patch("orders", order, client=client.pk)
        self.assertEqual(linked["client"], client.pk)
        self.assertEqual(linked["notes"], "Awaiting client details")

    def test_driver_and_van_saved_without_partner_and_linked_later(self):
        self.assertFalse(Partner.objects.exists())
        van = self.create("vehicles", partner=None, registration="INDEPENDENT", registration_country="RO", default_rate="0.4")
        driver = self.create("drivers", full_name="Independent driver", phone="+40123456789", usual_vehicle=van["id"])
        self.assertIsNone(van["partner"])
        self.assertIsNone(driver["partner"])
        partner = Partner.objects.create(name="Later partner", country="RO")
        # Assign either profile first, even while the other's partner is unknown.
        self.patch("vehicles", van, partner=partner.pk)
        driver = self.patch("drivers", driver, notes="Partner details pending")
        driver = self.patch("drivers", driver, partner=partner.pk)
        self.assertEqual(driver["usual_vehicle"], van["id"])
        driver = self.patch("drivers", driver, partner=None)
        self.assertIsNone(driver["partner"])
        self.assertEqual(driver["usual_vehicle"], van["id"])

    def test_unknown_partners_allow_planning_but_known_mismatch_is_rejected(self):
        van = self.create("vehicles", registration="UNLINKED", registration_country="RO", default_rate="0.4")
        driver = self.create("drivers", partner=None, full_name="Unlinked driver", phone="+40123456789")
        partner = Partner.objects.create(name="Trip partner", country="RO")
        trip = self.create("trips", dispatcher=None, partner=partner.pk, vehicle=van["id"], driver=driver["id"])
        self.assertEqual(trip["status"], "planned")
        self.assertEqual(trip["rate"], "0.4000")
        other = Partner.objects.create(name="Other partner", country="RO")
        self.patch("vehicles", van, partner=other.pk)
        response = self.api.post("/api/drivers/", {"partner": partner.pk, "full_name": "Mismatch", "phone": "123", "usual_vehicle": van["id"]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("usual_vehicle", response.data)
        response = self.api.post("/api/trips/", {"partner": partner.pk, "vehicle": van["id"]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("vehicle", response.data)


class DispatchFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("dispatcher@example.test", "Correct-Horse-724!", full_name="Dispatcher")
        self.manager = User.objects.create_user("manager@example.test", "Correct-Horse-724!", full_name="Manager", role="manager")
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.client_record = Client.objects.create(name="Client A", country="Romania")
        self.partner = Partner.objects.create(name="Partner A", country="Romania")
        self.van = Vehicle.objects.create(partner=self.partner, registration="TEST 123", registration_country="RO", default_rate="0.4")
        self.driver = Driver.objects.create(partner=self.partner, full_name="Driver A", phone="+40000000000")

    def order(self, price="550"):
        order = Order.objects.create(client=self.client_record, dispatcher=self.user, price=price)
        pickup = Stop.objects.create(order=order, kind="collection", location_name="Warehouse A")
        delivery = Stop.objects.create(order=order, kind="delivery", location_name="Warehouse B", position=2)
        Cargo.objects.create(order=order, collection=pickup, delivery=delivery, description="Pallets", reported={"quantity": "3"})
        return order, pickup, delivery

    def trip(self):
        return Trip.objects.create(dispatcher=self.user, partner=self.partner, vehicle=self.van, driver=self.driver, rate="0.4", actual_km="1300")

    def command(self, resource, obj, action, expected=200, **values):
        obj.refresh_from_db()
        response = self.api.post(f"/api/{resource}/{obj.pk}/command/", {"version": obj.version, "action": action, **values}, format="json")
        self.assertEqual(response.status_code, expected, response.data)
        obj.refresh_from_db()
        return response

    def visit(self, trip, stop):
        visit = Visit.objects.create(trip=trip, location_name=stop.location_name)
        response = self.api.post("/api/attempts/", {"stop": stop.pk, "visit": visit.pk}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return visit, Attempt.objects.get(pk=response.data["id"])

    def complete(self, visit, attempt):
        self.command("visits", visit, "en_route")
        self.command("visits", visit, "arrive")
        self.command("attempts", attempt, "complete")
        self.command("visits", visit, "depart")

    def test_confirmation_needs_price_but_not_documents_or_exact_address(self):
        order, _, _ = self.order(price=None)
        self.command("orders", order, "confirm", expected=400)
        order.price = Decimal("550")
        order.save()
        self.command("orders", order, "confirm")
        self.assertEqual(order.status, "confirmed")

    def test_shared_trip_distance_is_paid_once(self):
        trip = self.trip()
        for price in ["550", "250"]:
            order, _, _ = self.order(price)
            Leg.objects.create(order=order, trip=trip)
        figures = financials(trip)
        self.assertEqual(Decimal(figures["cost"]), Decimal("520"))
        self.assertEqual(Decimal(figures["revenue"]), Decimal("800"))
        self.assertEqual(Decimal(figures["margin"]), Decimal("280"))

    def test_default_rate_changes_preserve_existing_trip(self):
        trip = self.trip()
        response = self.api.patch(f"/api/vehicles/{self.van.pk}/", {"version": self.van.version, "default_rate": "0.48"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        trip.refresh_from_db()
        self.assertEqual(trip.rate, Decimal("0.4"))

    def test_stale_edit_is_rejected_without_losing_first_change(self):
        order, _, _ = self.order()
        url = f"/api/orders/{order.pk}/"
        self.assertEqual(self.api.patch(url, {"version": 1, "notes": "First change"}, format="json").status_code, 200)
        response = self.api.patch(url, {"version": 1, "notes": "Old screen"}, format="json")
        self.assertEqual(response.status_code, 409)
        order.refresh_from_db()
        self.assertEqual(order.notes, "First change")

    def test_dispatcher_edits_actual_cargo_without_approval(self):
        order, _, _ = self.order()
        cargo = order.cargo.get()
        response = self.api.patch(f"/api/cargo/{cargo.pk}/", {"version": cargo.version, "actual": {"quantity": "5", "weight_kg": "900"}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Review.objects.count(), 0)

    def test_client_price_revision_requires_reason(self):
        order, _, _ = self.order()
        url = f"/api/orders/{order.pk}/"
        self.assertEqual(self.api.patch(url, {"version": 1, "price": "600"}, format="json").status_code, 400)
        response = self.api.patch(url, {"version": 1, "price": "600", "change_reason": "Extra goods agreed with client"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def test_independent_outcomes_and_retry_keep_order_in_progress(self):
        order, pickup, _ = self.order()
        self.command("orders", order, "confirm")
        trip = self.trip()
        Leg.objects.create(order=order, trip=trip)
        self.command("trips", trip, "start")
        visit, attempt = self.visit(trip, pickup)
        self.command("visits", visit, "en_route")
        self.command("visits", visit, "arrive")
        self.command("attempts", attempt, "fail", reason="Goods unavailable")
        self.command("visits", visit, "depart")
        retry, next_attempt = self.visit(trip, pickup)
        pickup.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(pickup.status, "planned")
        self.assertEqual(order.status, "in_progress")
        self.assertEqual(pickup.attempts.count(), 2)
        self.complete(retry, next_attempt)

    def test_post_collection_cancellation_returns_without_manager_approval(self):
        order, pickup, delivery = self.order()
        self.command("orders", order, "confirm")
        trip = self.trip()
        Leg.objects.create(order=order, trip=trip)
        self.command("trips", trip, "start")
        visit, attempt = self.visit(trip, pickup)
        self.complete(visit, attempt)
        self.command("orders", order, "cancel", reason="Client's paperwork is incorrect")
        self.assertTrue(order.return_pending)
        self.assertEqual(order.status, "in_progress")
        self.assertEqual(Review.objects.count(), 0)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "cancelled")
        return_stop = order.stops.get(kind="return")
        return_visit, return_attempt = self.visit(trip, return_stop)
        self.complete(return_visit, return_attempt)
        order.refresh_from_db()
        self.assertEqual(order.status, "cancelled")
        self.assertEqual(order.resolution, "Returned to loading point")

    def test_handover_allocation_is_provisional_until_balanced(self):
        order, _, _ = self.order()
        first, second = self.trip(), self.trip()
        Leg.objects.create(order=order, trip=first, allocated_revenue="350")
        other = Leg.objects.create(order=order, trip=second)
        first.status = second.status = "finished"
        first.save()
        second.save()
        self.assertTrue(financials(first)["provisional"])
        other.allocated_revenue = Decimal("200")
        other.save()
        self.assertFalse(financials(first)["provisional"])
        self.assertEqual(Decimal(financials(first)["revenue"]), Decimal("350"))

    def test_only_manager_can_archive_profiles_and_manage_accounts(self):
        self.assertEqual(self.api.patch(f"/api/clients/{self.client_record.pk}/", {"version": 1, "is_active": False}, format="json").status_code, 403)
        self.assertEqual(self.api.post("/api/users/", {"email": "another@test.test", "full_name": "Another", "password": "Correct-Horse-123!"}, format="json").status_code, 403)
        self.api.force_authenticate(self.manager)
        response = self.api.patch(f"/api/clients/{self.client_record.pk}/", {"version": 1, "is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def test_login_requires_csrf_and_documents_require_authentication(self):
        browser = BrowserClient(enforce_csrf_checks=True)
        self.assertEqual(browser.post("/api/auth/login/", {"email": self.user.email, "password": "Correct-Horse-724!"}, content_type="application/json").status_code, 403)
        token = browser.get("/api/auth/csrf/").json()["csrfToken"]
        response = browser.post("/api/auth/login/", {"email": self.user.email, "password": "Correct-Horse-724!"}, content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        browser.post("/api/auth/logout/", content_type="application/json", HTTP_X_CSRFTOKEN=response.json()["csrfToken"])
        self.assertEqual(browser.get("/api/orders/").status_code, 403)

    def test_document_replacement_preserves_original_and_private_download(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            document = Document.objects.create(title="Loading CMR", kind="loading_cmr")
            for name in ["original.pdf", "signed.pdf"]:
                response = self.api.post(f"/api/documents/{document.pk}/upload/", {"file": SimpleUploadedFile(name, b"%PDF-1.4 test", content_type="application/pdf")}, format="multipart")
                self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(DocumentVersion.objects.filter(document=document).count(), 2)
            self.api.force_authenticate(None)
            self.assertEqual(self.api.get(f"/api/documents/{document.pk}/download/").status_code, 403)

    def test_delivery_completion_and_manager_reopening(self):
        order, pickup, delivery = self.order()
        self.command("orders", order, "confirm")
        trip = self.trip()
        Leg.objects.create(order=order, trip=trip)
        self.command("trips", trip, "start")
        for stop in [pickup, delivery]:
            visit, attempt = self.visit(trip, stop)
            self.complete(visit, attempt)
        order.refresh_from_db()
        trip.refresh_from_db()
        self.assertEqual(order.status, "delivered")
        self.assertEqual(trip.status, "in_progress")
        self.command("orders", order, "request_reopen", stop=delivery.pk, reason="Delivery was recorded against the wrong stop")
        review = order.reviews.get(kind="reopen_order")
        self.command("reviews", review, "approve", expected=403)
        self.api.force_authenticate(self.manager)
        self.command("reviews", review, "approve")
        order.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(order.status, "in_progress")
        self.assertEqual(delivery.status, "planned")

    def test_breakdown_handover_preserves_order_and_moves_remaining_work(self):
        order, pickup, delivery = self.order()
        self.command("orders", order, "confirm")
        source = self.trip()
        source_leg = Leg.objects.create(order=order, trip=source)
        self.command("trips", source, "start")
        visit, attempt = self.visit(source, pickup)
        self.complete(visit, attempt)
        _, old_delivery = self.visit(source, delivery)
        self.command("trips", source, "interrupt", reason="Breakdown")
        other_van = Vehicle.objects.create(partner=self.partner, registration="REPLACEMENT", registration_country="RO", default_rate="0.48")
        receiving = Trip.objects.create(dispatcher=self.user, partner=self.partner, vehicle=other_van, driver=self.driver, rate="0.48")
        self.command("orders", order, "handover", from_leg=source_leg.pk, to_trip=receiving.pk, location="Recovery parking", reason="Van breakdown", is_emergency=True)
        old_delivery.refresh_from_db()
        source_leg.refresh_from_db()
        delivery.refresh_from_db()
        self.assertFalse(old_delivery.is_current)
        self.assertIsNotNone(source_leg.ended_at)
        self.assertEqual(delivery.attempts.get(is_current=True).visit.trip_id, receiving.pk)
        self.assertEqual(order.status, "in_progress")
        self.assertEqual(order.handovers.count(), 1)
        self.assertEqual(order.reviews.get(kind="handover").status, "pending")
        self.command("trips", source, "finish", reason="Goods handed over after breakdown")

    def test_one_visit_can_have_two_independent_order_outcomes(self):
        first, pickup_a, _ = self.order()
        second, pickup_b, _ = self.order("250")
        for order in [first, second]:
            self.command("orders", order, "confirm")
        trip = self.trip()
        for order in [first, second]:
            Leg.objects.create(order=order, trip=trip)
        self.command("trips", trip, "start")
        visit, a = self.visit(trip, pickup_a)
        response = self.api.post("/api/attempts/", {"visit": visit.pk, "stop": pickup_b.pk}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        b = Attempt.objects.get(pk=response.data["id"])
        self.command("visits", visit, "en_route")
        self.command("visits", visit, "arrive")
        self.command("attempts", a, "complete")
        self.command("attempts", b, "fail", reason="Second client's goods are not ready")
        self.command("visits", visit, "depart")
        pickup_a.refresh_from_db()
        pickup_b.refresh_from_db()
        self.assertEqual(pickup_a.status, "completed")
        self.assertEqual(pickup_b.status, "unsuccessful")

    def test_client_profile_edits_preserve_order_booking_snapshot(self):
        order, _, _ = self.order()
        self.command("orders", order, "confirm")
        self.client_record.name = "New client profile name"
        self.client_record.save()
        response = self.api.get(f"/api/orders/{order.pk}/")
        self.assertEqual(response.data["client_label"], "Client A")

    def test_partner_and_vehicle_cost_totals_count_shared_trip_once(self):
        trip = self.trip()
        trip.status = "finished"
        trip.save()
        for price in ["550", "250"]:
            order, _, _ = self.order(price)
            Leg.objects.create(order=order, trip=trip)
        for resource, profile in [("partners", self.partner), ("vehicles", self.van)]:
            response = self.api.get(f"/api/{resource}/{profile.pk}/")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(Decimal(response.data["transport_cost_total"]), Decimal("520"))
            self.assertEqual(Decimal(response.data["payable_km_total"]), Decimal("1300"))
            self.assertEqual(response.data["trip_count"], 1)

    def test_edited_account_email_remains_case_insensitive_for_login(self):
        self.api.force_authenticate(self.manager)
        response = self.api.patch(f"/api/users/{self.user.pk}/", {"version": self.user.version, "email": "Updated.Dispatcher@EXAMPLE.TEST"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        browser = BrowserClient()
        response = browser.post("/api/auth/login/", {"email": "UPDATED.DISPATCHER@example.test", "password": "Correct-Horse-724!"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)

    def test_equivalent_numeric_cargo_formats_are_not_reported_as_different(self):
        order, _, _ = self.order()
        cargo = order.cargo.get()
        response = self.api.patch(f"/api/cargo/{cargo.pk}/", {"version": cargo.version, "actual": {"quantity": "3.00"}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["has_discrepancy"])

