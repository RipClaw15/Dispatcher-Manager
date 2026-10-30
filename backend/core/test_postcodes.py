import io
import zipfile
import csv
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from directory.models import PostalDataset, PostalPlace
from directory.postcodes import import_archive
from directory.postal_scope import EEA_COUNTRIES, EEA_UK_COUNTRIES
from orders.models import Order, Stop
from directory.eurostat_postcodes import import_eurostat_csv


def archive(country, rows):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as source:
        source.writestr(f"{country}.txt", "\n".join("\t".join([country, postcode, place, admin, "", "", "", "", "", "0", "0", "1"]) for postcode, place, admin in rows))
    return output.getvalue()


class PostcodeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("postcode@example.test", "Disposable-Postcode-724!")

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_scope_includes_all_eea_states_and_uk_parent(self):
        self.assertEqual(len(set(EEA_COUNTRIES)), 30)
        self.assertEqual(len(set(EEA_UK_COUNTRIES)), 31)
        self.assertTrue({"HU", "GR", "LT", "IS", "LI", "NO", "GB"} <= set(EEA_UK_COUNTRIES))

    def test_city_postcode_and_accent_insensitive_search(self):
        import_archive("HU", archive("HU", [("1138", "Budapest", "Budapest"), ("1117", "Budapest", "Budapest"), ("9021", "Győr", "Győr-Moson-Sopron")]))
        city = self.api.get("/api/postcodes/", {"country": "Hungary", "q": "Budap"})
        self.assertEqual(city.status_code, 200, city.data)
        self.assertEqual(len(city.data["results"]), 2)
        self.assertEqual(self.api.get("/api/postcodes/?country=HU&q=1138").data["results"][0]["place_name"], "Budapest")
        self.assertEqual(self.api.get("/api/postcodes/?country=HU&q=gyor").data["results"][0]["postal_code"], "9021")
        self.assertEqual(self.api.get("/api/postcodes/?country=HU&q=Budapest%201138").data["results"][0]["postal_code"], "1138")

    def test_uk_country_selection_filters_the_shared_uk_dataset(self):
        import_archive("GB", archive("GB", [("EH1", "Edinburgh", "Scotland"), ("BT1", "Belfast", "Northern Ireland"), ("CF10", "Cardiff", "Wales"), ("SW1A", "London", "England")]))
        for country, query, place in [("GB-SCT", "Edin", "Edinburgh"), ("GB-NIR", "BT", "Belfast"), ("GB-WLS", "CF", "Cardiff"), ("GB-ENG", "SW", "London")]:
            response = self.api.get("/api/postcodes/", {"country": country, "q": query})
            self.assertEqual(response.data["results"][0]["place_name"], place)
            self.assertEqual(response.data["postcode_precision"], "prefix")
        self.assertEqual(self.api.get("/api/postcodes/?country=GB-SCT&q=London").data["results"], [])

    def test_refresh_is_idempotent_and_does_not_rewrite_shipments(self):
        content = archive("HU", [("1138", "Budapest", "Budapest"), ("1138", "Budapest", "Budapest")])
        import_archive("HU", content)
        order = Order.objects.create(dispatcher=self.user)
        stop = Stop.objects.create(order=order, kind="delivery", city="My entered city", postal_code="1138")
        import_archive("HU", content)
        self.assertEqual(PostalPlace.objects.count(), 1)
        stop.refresh_from_db()
        self.assertEqual(stop.city, "My entered city")
        with self.assertRaises(ValueError):
            import_archive("HU", archive("HU", []))
        self.assertEqual(PostalPlace.objects.count(), 1)

    def test_postcode_with_missing_town_is_retained_without_inventing_a_city(self):
        import_archive("LT", archive("LT", [("38052", "", "Panevėžys")]))
        result = self.api.get("/api/postcodes/?country=LT&q=38052").data
        self.assertEqual(result["results"][0]["place_name"], "")

    def test_no_data_manual_fallback_authentication_and_read_only(self):
        response = self.api.get("/api/postcodes/?country=GR&q=Athens")
        self.assertFalse(response.data["available"])
        self.assertEqual(response.data["results"], [])
        self.assertEqual(self.api.post("/api/postcodes/", {}).status_code, 405)
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get("/api/postcodes/?country=HU&q=Budapest").status_code, 403)

    def test_eurostat_import_normalizes_greece_and_preserves_full_dutch_codes_and_uk(self):
        import_archive("GB", archive("GB", [("EH1", "Edinburgh", "Scotland")]))
        with TemporaryDirectory() as directory:
            source = Path(directory) / "eurostat.csv"
            with source.open("w", encoding="utf-8", newline="") as output:
                writer = csv.writer(output)
                writer.writerow(["CNTR_ID", "POSTCODE", "LAU_NAME"])
                writer.writerows([["HU", "1138", "Budapest"], ["EL", "10431", "Αθηναίων"], ["NL", "3204 XD", "Nissewaard"]])
            counts = import_eurostat_csv(source, countries={"HU", "GR", "NL"})
            self.assertEqual(counts, {"GR": 1, "HU": 1, "NL": 1})
            with self.assertRaises(ValueError):
                import_eurostat_csv(source, countries={"HU", "DE"})
        self.assertEqual(PostalDataset.objects.get(pk="GB").provider_name, "GeoNames")
        response = self.api.get("/api/postcodes/?country=NL&q=3204XD")
        self.assertEqual(response.data["results"][0]["postal_code"], "3204 XD")
        self.assertEqual(response.data["postcode_precision"], "postcode")
        self.assertEqual(response.data["source"], "Eurostat GISCO")
        self.assertEqual(response.data["license"], "CC BY-SA 4.0")
        self.assertTrue(self.api.get("/api/postcodes/?country=GR&q=10431").data["available"])
