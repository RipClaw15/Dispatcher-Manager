from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent
from directory.models import Client, Contact, Location, Partner
from documents.models import Document, DocumentLink, DocumentVersion
from fleet.models import Driver, Vehicle
from orders.models import Cargo, Order, Stop
from trips.models import Attempt, Extra, Leg, Trip, Visit


class DeletionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.dispatcher = User.objects.create_user("delete-dispatcher@example.test", "Correct-Horse-724!", full_name="Dispatcher")
        cls.manager = User.objects.create_user("delete-manager@example.test", "Correct-Horse-724!", full_name="Manager", role="manager")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.dispatcher)

    def preview(self, resource, obj):
        response = self.api.get(f"/api/{resource}/{obj.pk}/delete-preview/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def delete(self, resource, obj, preview=None, expected=204):
        preview = preview if preview is not None else self.preview(resource, obj)
        response = self.api.delete(f"/api/{resource}/{obj.pk}/", {
            "version": preview["version"], "confirmation_token": preview["confirmation_token"]}, format="json")
        self.assertEqual(response.status_code, expected, getattr(response, "data", None))
        return response

    def draft(self):
        order = Order.objects.create(dispatcher=self.dispatcher)
        pickup = Stop.objects.create(order=order, kind="collection", location_name="Loading point")
        delivery = Stop.objects.create(order=order, kind="delivery", location_name="Delivery point")
        cargo = Cargo.objects.create(order=order, collection=pickup, delivery=delivery, description="Pallets")
        return order, pickup, delivery, cargo

    def test_unused_profiles_delete_for_manager_and_keep_audit_history(self):
        self.api.force_authenticate(self.manager)
        partner = Partner.objects.create(name="Unused partner", country="RO")
        client = Client.objects.create(name="Unused client", country="RO")
        contact = Contact.objects.create(client=client, name="Unused contact")
        driver = Driver.objects.create(full_name="Unused driver", phone="123")
        van = Vehicle.objects.create(registration="DELETE TEST", registration_country="RO", default_rate="0.4")
        location = Location.objects.create(name="Unused location")
        for resource, obj in [("contacts", contact), ("clients", client), ("partners", partner),
                              ("drivers", driver), ("vehicles", van), ("locations", location)]:
            with self.subTest(resource=resource):
                original_pk = obj.pk
                preview = self.preview(resource, obj)
                self.assertTrue(preview["allowed"])
                self.delete(resource, obj, preview)
                self.assertFalse(type(obj).objects.filter(pk=original_pk).exists())
                event = AuditEvent.objects.get(resource=obj._meta.model_name, object_id=original_pk, action="deleted")
                self.assertEqual(event.actor, self.manager)
                self.assertTrue(event.after["deleted"])
                self.assertEqual(event.before["id"], original_pk)

    def test_dispatcher_cannot_delete_profiles_even_with_manager_confirmation(self):
        driver = Driver.objects.create(full_name="Driver", phone="123")
        self.api.force_authenticate(self.manager)
        preview = self.preview("drivers", driver)
        self.api.force_authenticate(self.dispatcher)
        response = self.api.get(f"/api/drivers/{driver.pk}/delete-preview/")
        self.assertEqual(response.status_code, 403)
        self.delete("drivers", driver, preview, expected=403)
        self.assertTrue(Driver.objects.filter(pk=driver.pk).exists())

    def test_draft_deletion_includes_its_stops_and_cargo_but_keeps_client(self):
        order, pickup, delivery, cargo = self.draft()
        client = Client.objects.create(name="Retained client", country="RO")
        order.client = client
        order.save()
        AuditEvent.objects.create(actor=self.dispatcher, actor_name="Dispatcher", resource="order", object_id=order.pk, action="created")
        preview = self.preview("orders", order)
        self.assertCountEqual(preview["items"], [{"kind": "cargo", "count": 1}, {"kind": "stop", "count": 2}, {"kind": "order", "count": 1}])
        self.delete("orders", order, preview)
        self.assertFalse(Order.objects.exists())
        self.assertFalse(Stop.objects.exists())
        self.assertFalse(Cargo.objects.exists())
        self.assertTrue(Client.objects.filter(pk=client.pk).exists())
        self.assertEqual(AuditEvent.objects.filter(action="deleted").count(), 4)
        self.assertTrue(AuditEvent.objects.filter(action="created", object_id=order.pk).exists())

    def test_order_history_and_linked_draft_assignments_are_blocked(self):
        for status in ["confirmed", "in_progress", "delivered", "cancelled"]:
            order = Order.objects.create(dispatcher=self.dispatcher, status=status)
            with self.subTest(status=status):
                self.assertFalse(self.preview("orders", order)["allowed"])
                self.delete("orders", order, expected=409)
                self.assertTrue(Order.objects.filter(pk=order.pk).exists())
        order, pickup, delivery, cargo = self.draft()
        trip = Trip.objects.create(dispatcher=self.dispatcher)
        Leg.objects.create(order=order, trip=trip)
        self.delete("orders", order, expected=409)
        self.assertTrue(Cargo.objects.filter(pk=cargo.pk).exists())
        self.assertEqual(order.stops.count(), 2)

    def test_linked_documents_block_order_and_stop_deletion_without_losing_files(self):
        order, pickup, _, _ = self.draft()
        document = Document.objects.create(title="Retained document")
        file = DocumentVersion.objects.create(document=document, file="retained.pdf", original_name="retained.pdf", uploaded_by=self.dispatcher)
        for resource, target in [("orders", order), ("stops", pickup)]:
            link = DocumentLink.objects.create(document=document, resource=resource, object_id=target.pk)
            with self.subTest(resource=resource):
                preview = self.preview("orders", order)
                self.assertFalse(preview["allowed"])
                self.assertTrue(any("documents" in reason for reason in preview["blockers"]))
                self.delete("orders", order, preview, expected=409)
                self.assertTrue(DocumentVersion.objects.filter(pk=file.pk).exists())
            link.delete()

    def test_profile_dependencies_include_set_null_and_contact_references(self):
        self.api.force_authenticate(self.manager)
        van = Vehicle.objects.create(registration="IN USE", registration_country="RO", default_rate="0.4")
        driver = Driver.objects.create(full_name="Driver", phone="123", usual_vehicle=van)
        self.delete("vehicles", van, expected=409)
        driver.refresh_from_db()
        self.assertEqual(driver.usual_vehicle_id, van.pk)
        client = Client.objects.create(name="Client", country="RO")
        contact = Contact.objects.create(client=client, name="Contact")
        Order.objects.create(dispatcher=self.dispatcher, client=client, booking_contact=contact)
        self.delete("contacts", contact, expected=409)
        self.delete("clients", client, expected=409)
        Trip.objects.create(dispatcher=self.dispatcher, driver=driver)
        self.delete("drivers", driver, expected=409)

    def test_unstarted_trip_deletes_its_unused_visits_but_not_assigned_work_or_costs(self):
        trip = Trip.objects.create(dispatcher=self.dispatcher)
        visit = Visit.objects.create(trip=trip, location_name="Planned checkpoint")
        self.delete("trips", trip)
        self.assertFalse(Visit.objects.filter(pk=visit.pk).exists())
        for case in ["leg", "cost", "attempt", "order_link", "started", "distance"]:
            trip = Trip.objects.create(dispatcher=self.dispatcher)
            order = Order.objects.create(dispatcher=self.dispatcher)
            visit = Visit.objects.create(trip=trip)
            if case == "leg":
                Leg.objects.create(order=order, trip=trip)
            elif case == "cost":
                Extra.objects.create(trip=trip, description="Agreed extra", amount="5")
            elif case == "attempt":
                stop = Stop.objects.create(order=order, kind="collection")
                Attempt.objects.create(stop=stop, visit=visit)
            elif case == "order_link":
                visit.orders.add(order)
            elif case == "started":
                trip.status = "in_progress"
                trip.save()
            else:
                trip.actual_km = 10
                trip.save()
            with self.subTest(case=case):
                self.delete("trips", trip, expected=409)
                self.assertTrue(Visit.objects.filter(pk=visit.pk).exists())

    def test_deletion_requires_valid_confirmation_and_rechecks_all_child_versions(self):
        order, pickup, _, cargo = self.draft()
        response = self.api.delete(f"/api/orders/{order.pk}/", {"version": order.version}, format="json")
        self.assertEqual(response.status_code, 400)
        original = self.preview("orders", order)
        self.delete("orders", order, {**original, "confirmation_token": "tampered"}, expected=409)
        cargo.version += 1
        cargo.save()
        self.delete("orders", order, original, expected=409)
        latest = self.preview("orders", order)
        Stop.objects.create(order=order, kind="collection")
        self.delete("orders", order, latest, expected=409)
        self.assertFalse(AuditEvent.objects.filter(action="deleted").exists())
        latest = self.preview("orders", order)
        response = self.api.patch(f"/api/orders/{order.pk}/", {"version": order.version, "notes": "Changed"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.delete("orders", order, latest, expected=409)

    def test_new_reference_after_preview_blocks_deletion(self):
        self.api.force_authenticate(self.manager)
        driver = Driver.objects.create(full_name="Driver", phone="123")
        preview = self.preview("drivers", driver)
        Trip.objects.create(dispatcher=self.dispatcher, driver=driver)
        self.delete("drivers", driver, preview, expected=409)
        self.assertTrue(Driver.objects.filter(pk=driver.pk).exists())

    def test_empty_documents_only_and_no_account_or_history_deletion(self):
        document = Document.objects.create(title="Empty entry")
        self.delete("documents", document)
        document = Document.objects.create(title="Uploaded file")
        DocumentVersion.objects.create(document=document, file="retain.pdf", original_name="retain.pdf", uploaded_by=self.dispatcher)
        self.delete("documents", document, expected=409)
        self.api.force_authenticate(self.manager)
        response = self.api.delete(f"/api/users/{self.dispatcher.pk}/", {"version": self.dispatcher.version}, format="json")
        self.assertEqual(response.status_code, 405)
        self.assertTrue(User.objects.filter(pk=self.dispatcher.pk).exists())
        event = AuditEvent.objects.first()
        self.assertEqual(self.api.delete(f"/api/history/{event.pk}/").status_code, 405)

    def test_anonymous_and_csrf_protection_apply_to_delete(self):
        order = Order.objects.create(dispatcher=self.dispatcher)
        preview = self.preview("orders", order)
        self.api.force_authenticate(None)
        self.delete("orders", order, preview, expected=403)
        browser = APIClient(enforce_csrf_checks=True)
        browser.force_login(self.dispatcher)
        url = f"/api/orders/{order.pk}/"
        payload = {"version": preview["version"], "confirmation_token": preview["confirmation_token"]}
        self.assertEqual(browser.delete(url, payload, format="json").status_code, 403)
        token = browser.get("/api/auth/csrf/").json()["csrfToken"]
        self.assertEqual(browser.delete(url, payload, format="json", HTTP_X_CSRFTOKEN=token).status_code, 204)
        self.assertEqual(browser.delete(url, payload, format="json", HTTP_X_CSRFTOKEN=token).status_code, 404)
