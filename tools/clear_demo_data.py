"""Remove identified development fixtures; preserve accounts and other profiles.

Dry-run by default. Before applying, back up PostgreSQL and refuse to remove
fixtures if a real trip depends on them. Original upload bytes are retained so
the database backup can restore document versions if needed.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from accounts.models import User
from core.models import AuditEvent
from core.workflows import mutation
from documents.models import Document, DocumentLink, DocumentVersion
from fleet.models import Driver, Vehicle
from orders.models import Cargo, Order, Stop
from reviews.models import Review
from trips.models import Attempt, Extra, Handover, Leg, Trip, Visit


def ids(queryset):
    return set(queryset.values_list("pk", flat=True))


def run(apply=False):
    with mutation():
        order_ids = ids(Order.objects.filter(
            Q(client_reference__startswith="DEMO-") | Q(client_reference__startswith="E2E-"),
            client__name__in=["Northline Logistics (demo)", "Atelier Freight (demo)", "Benelux Trade (demo)"]))
        van_ids = ids(Vehicle.objects.filter(
            registration__in=["DEMO BOX 01", "DEMO CUR 02", "DEMO CUR 03"],
            partner__name__in=["Carpathia Couriers (demo)", "Danube Transport (demo)"]))
        trip_ids = ids(Trip.objects.filter(Q(name__startswith="E2E trip ") | Q(name__in=[
            "Germany → France · shared load", "Bavaria → Northern Italy"])))
        visit_ids = ids(Visit.objects.filter(trip_id__in=trip_ids))
        if Leg.objects.filter(trip_id__in=trip_ids).exclude(order_id__in=order_ids).exists():
            raise SystemExit("A demo trip contains an unrecognised order. Nothing was deleted.")
        if Visit.orders.through.objects.filter(visit_id__in=visit_ids).exclude(order_id__in=order_ids).exists():
            raise SystemExit("A demo visit is linked to an unrecognised order. Nothing was deleted.")
        if Trip.objects.filter(vehicle_id__in=van_ids).exclude(pk__in=trip_ids).exists():
            raise SystemExit("A demo van is used by an unrecognised trip. Nothing was deleted.")

        stop_ids = ids(Stop.objects.filter(order_id__in=order_ids))
        leg_ids = ids(Leg.objects.filter(Q(order_id__in=order_ids) | Q(trip_id__in=trip_ids)))
        targets = {"orders": order_ids, "stops": stop_ids, "trips": trip_ids, "visits": visit_ids,
                   "legs": leg_ids, "vehicles": van_ids}
        document_ids = set()
        fixture_files = {"insurance-original.png", "insurance-renewed.png"}
        for document in Document.objects.filter(title__startswith="E2E insurance "):
            links = list(document.links.all())
            files = list(document.files.values_list("original_name", flat=True))
            if links and files and set(files) <= fixture_files and all(link.object_id in targets.get(link.resource, set()) for link in links):
                document_ids.add(document.pk)
        summary = {"orders": len(order_ids), "vans": len(van_ids), "trips": len(trip_ids), "test_documents": len(document_ids)}
        print(json.dumps(summary))
        if not apply or not any(summary.values()):
            return

        backups = ROOT / ".local" / "backups"
        backups.mkdir(parents=True, exist_ok=True)
        backup = backups / ("before-demo-cleanup-" + timezone.localtime().strftime("%Y%m%d-%H%M%S") + ".dump")
        database = settings.DATABASES["default"]
        subprocess.run([str(ROOT / ".local" / "pgsql" / "bin" / "pg_dump.exe"),
                        "--format=custom", "--no-owner", "--file", str(backup), "-h", database["HOST"],
                        "-p", str(database["PORT"]), "-U", database["USER"], database["NAME"]],
                       env={**os.environ, "PGPASSWORD": database["PASSWORD"]}, check=True)

        audit_targets = {"order": order_ids, "stop": stop_ids, "trip": trip_ids, "visit": visit_ids,
                         "leg": leg_ids, "vehicle": van_ids, "document": document_ids,
                         "cargo": ids(Cargo.objects.filter(order_id__in=order_ids)),
                         "attempt": ids(Attempt.objects.filter(Q(stop_id__in=stop_ids) | Q(visit_id__in=visit_ids))),
                         "review": ids(Review.objects.filter(order_id__in=order_ids)),
                         "extra": ids(Extra.objects.filter(trip_id__in=trip_ids)),
                         "handover": ids(Handover.objects.filter(Q(order_id__in=order_ids) | Q(from_leg_id__in=leg_ids) | Q(to_leg_id__in=leg_ids)))}
        for resource, object_ids in targets.items():
            DocumentLink.objects.filter(resource=resource, object_id__in=object_ids).delete()
        DocumentLink.objects.filter(document_id__in=document_ids).delete()
        DocumentVersion.objects.filter(document_id__in=document_ids).delete()
        Document.objects.filter(pk__in=document_ids).delete()
        Handover.objects.filter(pk__in=audit_targets["handover"]).delete()
        Review.objects.filter(pk__in=audit_targets["review"]).delete()
        Attempt.objects.filter(pk__in=audit_targets["attempt"]).delete()
        Cargo.objects.filter(pk__in=audit_targets["cargo"]).delete()
        Leg.objects.filter(pk__in=leg_ids).delete()
        Visit.objects.filter(pk__in=visit_ids).delete()
        Stop.objects.filter(pk__in=stop_ids, kind="return").delete()
        Stop.objects.filter(pk__in=stop_ids).delete()
        Order.objects.filter(pk__in=order_ids).delete()
        Extra.objects.filter(trip_id__in=trip_ids).delete()
        Trip.objects.filter(pk__in=trip_ids).delete()
        Driver.objects.filter(usual_vehicle_id__in=van_ids).update(usual_vehicle=None)
        Vehicle.objects.filter(pk__in=van_ids).delete()
        for resource, object_ids in audit_targets.items():
            AuditEvent.objects.filter(resource=resource, object_id__in=object_ids).delete()
        actor = User.objects.filter(role="manager", is_active=True).order_by("id").first()
        AuditEvent.objects.create(actor=actor, actor_name=str(actor), resource="maintenance", object_id=0,
                                  action="demo_data_cleared", before=summary, after={"backup": backup.name})
        marker = ROOT / ".local" / "real-data-mode"
        marker.write_text("Demo orders and vans were cleared for real data. Do not run fixture-writing browser tests against this database.\n", encoding="utf-8")
        print("Removed identified demo/test data. Accounts, clients, partners and driver profiles were preserved.")
        print("Database backup:", backup)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    run(parser.parse_args().apply)

