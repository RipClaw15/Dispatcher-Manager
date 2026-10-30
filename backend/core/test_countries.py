from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from directory.countries import country_lookup, resolve_country
from directory.models import Country
from orders.models import Order


class CountryRouteTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("countries@example.test", "Correct-Horse-724!", full_name="Dispatcher")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def create_route(self, points, **values):
        response = self.api.post("/api/orders/quick-entry/", {"route": points, **values}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Order.objects.get(pk=response.data["id"]), response.data["dispatch_summary"]

    def test_seeded_directory_covers_europe_and_nearby_countries(self):
        response = self.api.get("/api/countries/")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["count"], 60)
        codes = set(Country.objects.values_list("code", flat=True))
        self.assertTrue({"IT", "HU", "FR", "RO", "MA", "TR", "TN", "GB", "UA", "SI"} <= codes)
        self.assertEqual(resolve_country("UK", "", country_lookup())["code"], "GB")

    def test_duplicate_loading_codes_compact_only_the_summary(self):
        order, summary = self.create_route([
            {"kind": "collection", "short_code": "IT16", "country": "Italy"},
            {"kind": "collection", "short_code": "IT16", "country": "IT"},
            {"kind": "delivery", "short_code": "HU10", "country": "HU"},
        ], starting_code="IT16", starting_country="IT")
        self.assertEqual(order.stops.count(), 3)
        self.assertEqual(order.stops.filter(kind="collection").count(), 2)
        self.assertEqual(order.legs.get().trip.visits.count(), 3)
        self.assertEqual(len(summary["route"]), 3)
        self.assertEqual(summary["route_label"], "IT16 → HU10")
        self.assertEqual([point["country"]["code"] for point in summary["display_route"]], ["IT", "HU"])

    def test_uk_countries_are_searchable_and_keep_their_distinct_route_flags(self):
        for name, code in [("Scotland", "GB-SCT"), ("Northern Ireland", "GB-NIR"), ("Wales", "GB-WLS"), ("England", "GB-ENG")]:
            with self.subTest(country=name):
                response = self.api.get("/api/countries/", {"q": name})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertTrue(any(row["code"] == code for row in response.data["results"]))
                _, summary = self.create_route([{"kind": "collection", "short_code": "GB10", "country": name}])
                self.assertEqual(summary["display_route"][0]["country"]["code"], code)
                # A UK postcode alone continues to identify the UK generally.
                self.assertEqual(resolve_country("", "GB10", country_lookup())["code"], "GB")

    def test_a_return_to_an_area_is_not_removed(self):
        _, summary = self.create_route([{"kind": "collection", "short_code": "IT16"}, {"kind": "collection", "short_code": "AT10"}, {"kind": "delivery", "short_code": "IT16"}])
        self.assertEqual(summary["route_label"], "IT16 → AT10 → IT16")

    def test_identical_postal_codes_in_different_countries_are_distinct(self):
        _, summary = self.create_route([{"kind": "collection", "short_code": "16", "country": "IT"}, {"kind": "delivery", "short_code": "16", "country": "HU"}])
        self.assertEqual(len(summary["display_route"]), 2)
        self.assertEqual([point["country"]["code"] for point in summary["display_route"]], ["IT", "HU"])

    def test_explicit_country_wins_and_unrecognised_shorthand_is_not_guessed(self):
        lookup = country_lookup()
        self.assertIsNone(resolve_country("", "SL42", lookup))
        self.assertEqual(resolve_country("Slovenia", "SL42", lookup)["code"], "SI")
        self.assertEqual(resolve_country("Hungary", "IT16", lookup)["code"], "HU")
        self.assertEqual(resolve_country("", "UK10", lookup)["code"], "GB")

    def test_custom_country_persists_and_is_available_for_flags(self):
        response = self.api.post("/api/countries/", {"name": "Custom Transit Area", "code": "", "is_custom": False, "aliases": ["IT"]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        country = Country.objects.get(pk=response.data["id"])
        self.assertTrue(country.is_custom)
        self.assertEqual(country.aliases, [])
        _, summary = self.create_route([{"kind": "collection", "short_code": "A1", "country": country.name}, {"kind": "delivery", "short_code": "HU10", "country": "HU"}])
        self.assertEqual(summary["display_route"][0]["country"]["name"], country.name)
        self.assertEqual(summary["display_route"][0]["country"]["code"], "")
        known = self.api.post("/api/countries/", {"name": "Brazil", "code": "br"}, format="json")
        self.assertEqual(known.status_code, 201, known.data)
        self.assertEqual(known.data["code"], "BR")

    def test_duplicate_aliases_names_and_codes_are_rejected(self):
        for name in ["Italy", "italy", "UK"]:
            response = self.api.post("/api/countries/", {"name": name}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        response = self.api.post("/api/countries/", {"name": "Duplicate coded country", "code": "it"}, format="json")
        self.assertIn(response.status_code, [400, 409])
        response = self.api.post("/api/countries/", {"name": "Invalid coded country", "code": "12"}, format="json")
        self.assertEqual(response.status_code, 400)
        italy = Country.objects.get(code="IT")
        self.assertEqual(self.api.delete(f"/api/countries/{italy.pk}/").status_code, 405)

    def test_later_country_address_edit_updates_same_stop_and_flag(self):
        order, _ = self.create_route([{"kind": "collection", "short_code": "SL42"}, {"kind": "delivery", "short_code": "HU10"}])
        stop = order.stops.get(kind="collection")
        response = self.api.patch(f"/api/stops/{stop.pk}/", {"version": stop.version, "country": "SI", "postal_code": "4200"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        summary = self.api.get(f"/api/orders/{order.pk}/").data["dispatch_summary"]
        self.assertEqual(summary["display_route"][0]["country"]["code"], "SI")
        self.assertEqual(summary["display_route"][0]["code"], "SL42")
        self.assertEqual(order.stops.count(), 2)

    def test_starting_country_can_be_corrected_from_existing_order(self):
        order, _ = self.create_route([{"kind": "collection", "short_code": "IT16"}], starting_code="16", starting_country="IT")
        context = self.api.get(f"/api/orders/{order.pk}/dispatch-details/").data
        trip = context["trips"][0]
        response = self.api.post(f"/api/orders/{order.pk}/dispatch-details/", {"version": context["version"], "trip": trip["id"], "trip_version": trip["version"], "starting_country": "HU"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["dispatch_summary"]["display_route"][0]["country"]["code"], "HU")

    def test_country_directory_requires_login(self):
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get("/api/countries/").status_code, 403)
