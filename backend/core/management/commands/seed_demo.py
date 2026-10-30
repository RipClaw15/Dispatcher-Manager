import json
from pathlib import Path
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from directory.models import Client, Contact, Partner
from fleet.models import Driver, Vehicle
from orders.models import Cargo, Order, Stop
from trips.models import Attempt, Leg, Trip, Visit


class Command(BaseCommand):
    help = "Create explicitly labelled demo data and development accounts without overwriting existing records."

    def handle(self, *args, **options):
        local = Path(settings.BASE_DIR).parent / ".local"
        local.mkdir(exist_ok=True)
        credentials_path = local / "demo-credentials.json"
        credentials = json.loads(credentials_path.read_text()) if credentials_path.exists() else {}
        for role, name in [("manager", "Alex Manager"), ("dispatcher", "Maria Dispatcher")]:
            email = f"{role}@dispatch.local"
            if not User.objects.filter(email=email).exists():
                password = secrets.token_urlsafe(16)
                User.objects.create_user(email, password, full_name=name, role=role)
                credentials[role] = {"email": email, "password": password}
        credentials_path.write_text(json.dumps(credentials, indent=2), encoding="utf-8")
        if Order.objects.exists():
            self.stdout.write("Existing operational records preserved. Development credentials: .local/demo-credentials.json")
            return
        manager = User.objects.get(email="manager@dispatch.local")
        dispatcher = User.objects.get(email="dispatcher@dispatch.local")
        client_a = Client.objects.create(name="Northline Logistics (demo)", country="Germany", address="Demo business address", notes="Fictional review data")
        client_b = Client.objects.create(name="Atelier Freight (demo)", country="France", notes="Fictional review data")
        client_c = Client.objects.create(name="Benelux Trade (demo)", country="Belgium", notes="Fictional review data")
        Contact.objects.create(client=client_a, name="Client Operations", role="Bookings", email="operations@example.test")
        partner_a = Partner.objects.create(name="Carpathia Couriers (demo)", country="Romania")
        partner_b = Partner.objects.create(name="Danube Transport (demo)", country="Romania")
        now = timezone.now()
        van = Vehicle.objects.create(partner=partner_a, registration="DEMO BOX 01", registration_country="RO", vehicle_type="Box van", default_rate="0.40", payload_kg="1100", pallet_capacity=5, available_at=now + timedelta(days=1), available_region="Dortmund", available_country="Germany")
        curtain = Vehicle.objects.create(partner=partner_a, registration="DEMO CUR 02", registration_country="RO", vehicle_type="Curtain van", default_rate="0.48", pallet_capacity=8, available_at=now + timedelta(days=2), available_region="Lyon", available_country="France")
        third = Vehicle.objects.create(partner=partner_b, registration="DEMO CUR 03", registration_country="RO", vehicle_type="Curtain van", default_rate="0.46", available_at=now + timedelta(days=3), available_region="Munich", available_country="Germany")
        driver = Driver.objects.create(partner=partner_a, full_name="Andrei Pop (demo)", phone="+40 000 000 001", usual_vehicle=van)
        Driver.objects.create(partner=partner_a, full_name="Mihai Stan (demo)", phone="+40 000 000 002", usual_vehicle=curtain)
        Driver.objects.create(partner=partner_b, full_name="Dan Owner-driver (demo)", phone="+40 000 000 003", usual_vehicle=third)
        trip = Trip.objects.create(name="Germany → France · shared load", dispatcher=dispatcher, partner=partner_a, vehicle=van, driver=driver,
                                   rate="0.40", estimated_km="1300", planned_start=now + timedelta(days=1), planned_end=now + timedelta(days=2))
        for index, (client, price, pickup_city, delivery_city, goods) in enumerate([
            (client_a, "550", "Dortmund", "Lyon", "Automotive parts"),
            (client_b, "250", "Cologne", "Paris", "Packed display materials"),
        ]):
            order = Order.objects.create(client=client, dispatcher=dispatcher if index == 0 else manager,
                                         client_reference=f"DEMO-BOOKING-{index + 1}", price=price, status="confirmed",
                                         client_snapshot={"name": client.name, "country": client.country})
            collection = Stop.objects.create(order=order, kind="collection", location_name=f"{pickup_city} warehouse", city=pickup_city,
                                             country="Germany", postal_code="Location details pending", timezone="Europe/Berlin", position=1,
                                             planned_date=(now + timedelta(days=1)).date(), timing="window", time_from="08:00", time_to="14:00")
            delivery = Stop.objects.create(order=order, kind="delivery", location_name=f"{delivery_city} recipient", city=delivery_city,
                                           country="France", timezone="Europe/Paris", position=2, planned_date=(now + timedelta(days=2)).date(), timing="date")
            Cargo.objects.create(order=order, collection=collection, delivery=delivery, description=goods,
                                 reported={"quantity": "3" if index == 0 else "4", "package_type": "pallets" if index == 0 else "packages", "weight_kg": "750" if index == 0 else "160"})
            Leg.objects.create(order=order, trip=trip)
            for stop in [collection, delivery]:
                # Collections first, then deliveries; physical distance is entered separately.
                position = index + 1 if stop.kind == "collection" else index + 3
                visit = Visit.objects.create(trip=trip, position=position, location_name=stop.location_name, city=stop.city,
                                             country=stop.country, timezone=stop.timezone)
                Attempt.objects.create(stop=stop, visit=visit)
        Order.objects.create(client=client_c, dispatcher=dispatcher, client_reference="DEMO-AWAITING-DETAILS", price="450", notes="Draft booking; collection details are still coming in.")
        Trip.objects.create(name="Bavaria → Northern Italy", dispatcher=manager, estimated_km="800", planned_start=now + timedelta(days=3), planned_end=now + timedelta(days=4))
        self.stdout.write("Demo workspace created. Login credentials are in .local/demo-credentials.json (git-ignored).")

