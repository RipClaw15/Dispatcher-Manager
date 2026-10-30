from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditEvent
from directory.models import Country
from fleet.models import Driver
from orders.models import Order
from trips.models import Leg, Trip


class DriverCitizenshipTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("citizenship@example.test", "Disposable-Driver-724!")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_optional_citizenship_and_partner_allow_a_minimal_driver(self):
        response = self.api.post("/api/drivers/", {"full_name": "Driver", "phone": "123"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["citizenship"], "")
        self.assertIsNone(response.data["partner"])

    def test_dispatcher_can_record_citizenship_with_history_and_conflict_protection(self):
        driver = Driver.objects.create(full_name="Driver", phone="123")
        path = f"/api/drivers/{driver.pk}/"
        body = {"version": driver.version, "citizenship": "RO"}
        response = self.api.patch(path, body, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["citizenship_label"], "Romania")
        event = AuditEvent.objects.get(resource="driver", object_id=driver.pk, action="updated")
        self.assertEqual(event.before["citizenship"], "")
        self.assertEqual(event.after["citizenship"], "RO")
        self.assertEqual(self.api.patch(path, {**body, "citizenship": "HU"}, format="json").status_code, 409)
        driver.refresh_from_db()
        self.assertEqual(driver.citizenship, "RO")

    def test_custom_citizenship_is_supported_and_can_be_cleared(self):
        country = Country.objects.create(name="Custom citizenship country", is_custom=True)
        response = self.api.post("/api/drivers/", {"full_name": "Driver", "phone": "123", "citizenship": country.name}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["citizenship_label"], country.name)
        response = self.api.patch(f"/api/drivers/{response.data['id']}/", {"version": response.data["version"], "citizenship": ""}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["citizenship"], "")

    def test_assignment_responses_show_recorded_citizenship_without_changing_the_driver_name(self):
        driver = Driver.objects.create(full_name="Driver", phone="123", citizenship="RO")
        trip = Trip.objects.create(dispatcher=self.user, driver=driver)
        order = Order.objects.create(dispatcher=self.user)
        Leg.objects.create(trip=trip, order=order)
        trip_response = self.api.get(f"/api/trips/{trip.pk}/")
        summary = self.api.get(f"/api/orders/{order.pk}/").data["dispatch_summary"]
        self.assertEqual(trip_response.data["driver_citizenship"], "RO")
        self.assertEqual(summary["driver_citizenship"], "RO")
        self.assertEqual(summary["driver_label"], "Driver")
