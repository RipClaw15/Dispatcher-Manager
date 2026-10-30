import mimetypes
import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import Count, DecimalField, ExpressionWrapper, F, OuterRef, Prefetch, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce, Round
from django.http import FileResponse
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.routers import DefaultRouter
from rest_framework.views import exception_handler as drf_exception_handler

from accounts.models import User
from core.models import AuditEvent
from core.deletion import delete_record, deletion_plan
from core.workflows import audit, change, financials, mutation, perform, plan_attempt, require_version, snapshot, sync_single_point_location
from directory.models import Client, Contact, Country, Location, Partner
from directory.countries import country_lookup
from documents.models import Document, DocumentLink, DocumentVersion
from documents.queries import trip_document_ids
from fleet.models import Driver, Vehicle
from orders.models import Cargo, Order, Stop
from orders.quick_entry import QuickEntrySerializer, create_quick_order
from orders.dispatch import DispatchEditSerializer, edit_dispatch
from orders.summary import dispatch_summary
from orders.notebook import first_collection, notebook_query, loading_date_preview, LoadingDateSerializer, set_loading_date
from reviews.models import Review
from trips.models import Attempt, Extra, Handover, Leg, Trip, Visit

RESOURCES = {"clients": Client, "partners": Partner, "contacts": Contact, "locations": Location,
             "countries": Country,
             "vehicles": Vehicle, "drivers": Driver, "orders": Order, "stops": Stop, "cargo": Cargo,
             "trips": Trip, "legs": Leg, "visits": Visit, "attempts": Attempt, "extras": Extra,
             "handovers": Handover, "documents": Document, "reviews": Review}
PARENTS = {Stop: ["order"], Cargo: ["order", "collection", "delivery"], Visit: ["trip"],
           Leg: ["order", "trip"], Attempt: ["stop", "visit"], Extra: ["trip"]}
MANAGER_PROFILES = {Client, Partner, Driver, Location}
FILE_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff", ".bmp", ".doc", ".docx", ".odt"}


def trip_totals(profile):
    key = "partner" if isinstance(profile, Partner) else "vehicle"
    trips = Trip.objects.filter(**{key: profile})
    money_field = DecimalField(max_digits=24, decimal_places=2)
    extra_sum = Extra.objects.filter(trip_id=OuterRef("pk")).values("trip_id").annotate(total=Sum("amount")).values("total")[:1]
    known = trips.filter(Q(status="finished", actual_km__isnull=False, rate__isnull=False) | Q(status="cancelled"))
    known = known.annotate(recorded_cost=ExpressionWrapper(
        Coalesce(Round(F("actual_km") * F("rate"), 2), Value(Decimal("0")), output_field=money_field) +
        Coalesce(Subquery(extra_sum), Value(Decimal("0")), output_field=money_field), output_field=money_field))
    totals = known.aggregate(cost=Sum("recorded_cost"), km=Sum("actual_km"), count=Count("pk"))
    return {"trip_count": trips.count(), "finalized_trip_count": totals["count"],
            "payable_km_total": str(totals["km"] or Decimal("0")), "transport_cost_total": str(totals["cost"] or Decimal("0"))}


def cargo_differs(reported, actual):
    numeric = {"quantity", "weight_kg", "length_cm", "width_cm", "height_cm"}
    for key, value in actual.items():
        if key not in reported or value is None or str(value).strip() == "":
            continue
        if key in numeric:
            try:
                if Decimal(str(reported[key])) != Decimal(str(value)):
                    return True
                continue
            except (InvalidOperation, ValueError):
                pass
        if str(reported[key]).strip().casefold() != str(value).strip().casefold():
            return True
    return False


def exception_handler(exc, context):
    if isinstance(exc, IntegrityError):
        return Response({"detail": "This conflicts with an existing record or assignment. Refresh and review your entries."}, status=409)
    return drf_exception_handler(exc, context)


class RecordSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        model = self.Meta.model
        user = self.context["request"].user
        obj = self.instance
        value = lambda key: attrs.get(key, getattr(obj, key, None) if obj else None)
        if model is Country and attrs.get("name"):
            known = country_lookup().get(attrs["name"].strip().casefold())
            if known:
                raise ValidationError({"name": f"Select the saved country {known['name']} instead of adding a duplicate."})
        if model is Country and "code" in attrs:
            code = attrs["code"].strip().upper()
            code = {"UK": "GB", "EL": "GR"}.get(code, code)
            if code.startswith("UK-"):
                code = "GB-" + code[3:]
            if code and not re.fullmatch(r"[A-Z]{2}(-[A-Z]{3})?", code):
                raise ValidationError({"code": "Use a country or region code such as GB or GB-SCT, or leave it blank."})
            attrs["code"] = code
        for key in PARENTS.get(model, []):
            if obj and key in attrs and getattr(obj, key + "_id") != attrs[key].pk:
                raise ValidationError({key: "Keep this record linked to its original parent. Create a new record for different work."})
        if model in MANAGER_PROFILES and not user.is_manager and "is_active" in attrs and ((obj and attrs["is_active"] != obj.is_active) or (not obj and attrs["is_active"] is False)):
            raise PermissionDenied("Only a manager can archive or reactivate profiles.")
        if model is Vehicle and not user.is_manager and "status" in attrs and (attrs["status"] == "inactive" or (obj and obj.status == "inactive")):
            raise PermissionDenied("Only a manager can archive or reactivate vehicles.")
        for key, item in attrs.items():
            if isinstance(item, Decimal) and item < 0:
                raise ValidationError({key: "Use zero or a positive value."})
            if hasattr(item, "is_active") and not item.is_active and (not obj or getattr(obj, key + "_id", None) != item.pk):
                raise ValidationError({key: "Choose an active profile."})
        if attrs.get("timezone"):
            try:
                ZoneInfo(attrs["timezone"])
            except (ZoneInfoNotFoundError, ValueError):
                raise ValidationError({"timezone": "Use an IANA timezone, for example Europe/Berlin."})
        if model is Contact and bool(value("client")) == bool(value("partner")):
            raise ValidationError("Link a contact to exactly one client or transport partner.")
        if model is Order:
            if value("booking_contact") and value("booking_contact").client_id != getattr(value("client"), "pk", None):
                raise ValidationError({"booking_contact": "Choose a contact belonging to this client."})
            if obj and obj.status != "draft" and value("price") is None:
                raise ValidationError({"price": "An agreed price is required for this order."})
            if obj and "price" in attrs and attrs["price"] != obj.price and not str(self.initial_data.get("change_reason") or "").strip():
                raise ValidationError({"change_reason": "Explain the agreed price revision."})
        if model is Cargo:
            order, collection, delivery = value("order"), value("collection"), value("delivery")
            if not (collection and delivery and order) or collection.order_id != order.pk or delivery.order_id != order.pk or collection.kind != "collection" or delivery.kind != "delivery":
                raise ValidationError("Cargo must link a collection and delivery on the same order.")
            for key in ["reported", "actual"]:
                if key in attrs and not isinstance(attrs[key], dict):
                    raise ValidationError({key: "Enter cargo details as an object."})
        if model is Trip:
            vehicle, partner, driver = value("vehicle"), value("partner"), value("driver")
            if vehicle and partner and vehicle.partner_id and vehicle.partner_id != partner.pk:
                raise ValidationError({"vehicle": "Select a van supplied by this partner."})
            if driver and partner and driver.partner_id and driver.partner_id != partner.pk:
                raise ValidationError({"driver": "Select a driver supplied by this partner."})
            if vehicle and ((not obj and attrs.get("rate") is None) or (obj and "vehicle" in attrs and vehicle.pk != obj.vehicle_id and "rate" not in attrs)):
                attrs["rate"] = vehicle.default_rate
            if vehicle and "rate" in attrs and attrs["rate"] is not None and attrs["rate"] != vehicle.default_rate:
                changed = not obj or attrs["rate"] != obj.rate
                if changed and not (attrs.get("rate_reason") or (obj and obj.rate_reason)):
                    raise ValidationError({"rate_reason": "Explain the rate agreed for this trip."})
            if value("planned_start") and value("planned_end") and value("planned_end") < value("planned_start"):
                raise ValidationError({"planned_end": "The planned end must follow the start."})
        if model is Driver and value("usual_vehicle") and value("partner") and value("usual_vehicle").partner_id and value("usual_vehicle").partner_id != value("partner").pk:
            raise ValidationError({"usual_vehicle": "Choose a van supplied by this driver's partner."})
        if model is Document and value("valid_from") and value("expires_on") and value("expires_on") < value("valid_from"):
            raise ValidationError({"expires_on": "Expiry must follow the valid-from date."})
        if model is Leg and not obj:
            order, trip = value("order"), value("trip")
            if trip and trip.status in {"finished", "cancelled"}:
                raise ValidationError("Assign work to an open trip.")
            if order and order.status in {"delivered", "cancelled"}:
                raise ValidationError("This order is closed.")
            if order and order.legs.filter(is_cancelled=False, ended_at__isnull=True).exclude(trip=trip).exists():
                raise ValidationError("This order has another active leg. Use a handover, or release its planned assignment first.")
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        for field in instance._meta.fields:
            if field.many_to_one and field.name in data:
                related = getattr(instance, field.name)
                data[field.name + "_label"] = str(related) if related else ""
        if isinstance(instance, (Order, Trip)):
            data["reference"] = instance.reference
        if isinstance(instance, Order):
            collection = first_collection(instance)
            data["loading_date"] = collection.planned_date.isoformat() if collection and collection.planned_date else None
            if "country_lookup" not in self.context:
                self.context["country_lookup"] = country_lookup()
            data["dispatch_summary"] = dispatch_summary(instance, self.context.setdefault("dispatch_financials", {}), self.context["country_lookup"])
        if isinstance(instance, Country):
            data["country_flag"] = {"name": instance.name, "code": instance.code}
            data["country_source"] = "Custom" if instance.is_custom else "Saved reference"
        if isinstance(instance, Driver):
            if "country_lookup" not in self.context:
                self.context["country_lookup"] = country_lookup()
            country = self.context["country_lookup"].get(instance.citizenship.strip().casefold())
            data["citizenship_label"] = country["name"] if country else instance.citizenship
        if isinstance(instance, Order) and instance.client_snapshot:
            data["client_label"] = instance.client_snapshot.get("name", data.get("client_label", ""))
            contact = instance.client_snapshot.get("contact")
            if contact:
                data["booking_contact_label"] = contact.get("name", "") if isinstance(contact, dict) else contact
        if isinstance(instance, Trip):
            data["driver_citizenship"] = instance.driver.citizenship if instance.driver else ""
            data["financials"] = financials(instance)
            data["warnings"] = []
            if instance.planned_start and instance.planned_end:
                overlap = Trip.objects.exclude(pk=instance.pk).filter(status__in=["planned", "in_progress", "interrupted"],
                            planned_start__lt=instance.planned_end, planned_end__gt=instance.planned_start)
                for other in overlap.filter(Q(vehicle_id=instance.vehicle_id) | Q(driver_id=instance.driver_id)):
                    if (instance.vehicle_id and other.vehicle_id == instance.vehicle_id) or (instance.driver_id and other.driver_id == instance.driver_id):
                        data["warnings"].append(f"Resource assignment overlaps {other.reference}.")
            for delivery_attempt in Attempt.objects.filter(visit__trip=instance, is_current=True, stop__kind="delivery").select_related("stop", "visit"):
                for cargo in delivery_attempt.stop.cargo_delivered.select_related("collection"):
                    collection_attempt = cargo.collection.attempts.filter(is_current=True, visit__trip=instance).select_related("visit").first()
                    if cargo.collection.status != "completed" and collection_attempt and collection_attempt.visit.position >= delivery_attempt.visit.position:
                        data["warnings"].append(f"{delivery_attempt.stop.order.reference}: a delivery is planned before its collection. Review the route sequence.")
        if isinstance(instance, Client):
            data["order_count"] = instance.orders.count()
            data["agreed_revenue"] = str(instance.orders.aggregate(total=Sum("price"))["total"] or Decimal("0"))
            data["status_counts"] = {key: instance.orders.filter(status=key).count() for key in ["draft", "confirmed", "in_progress", "delivered", "cancelled"]}
            data["most_recent_order"] = instance.orders.order_by("-date_received").values_list("date_received", flat=True).first()
        if isinstance(instance, Partner):
            data["vehicle_count"] = instance.vehicles.count()
            data["driver_count"] = instance.drivers.count()
        if isinstance(instance, (Partner, Vehicle)):
            data.update(trip_totals(instance))
        if isinstance(instance, Cargo):
            data["has_discrepancy"] = cargo_differs(instance.reported, instance.actual)
        if isinstance(instance, Document):
            today = timezone.localdate()
            data["validity"] = "expired" if instance.expires_on and instance.expires_on < today else "expiring_soon" if instance.expires_on and instance.expires_on <= today + timedelta(days=30) else "current"
            data["files"] = [{"id": file.pk, "name": file.original_name, "uploaded_at": file.uploaded_at,
                              "uploaded_by": str(file.uploaded_by), "url": f"/api/documents/{instance.pk}/download/?file={file.pk}"}
                             for file in instance.files.select_related("uploaded_by")]
            data["links"] = []
            for link in instance.links.all():
                model = RESOURCES.get(link.resource)
                target = model.objects.filter(pk=link.object_id).first() if model else None
                url = f"#/{link.resource}/{link.object_id}"
                if isinstance(target, Stop):
                    url = f"#/orders/{target.order_id}"
                elif isinstance(target, (Visit, Leg)):
                    url = f"#/trips/{target.trip_id}"
                elif isinstance(target, Handover):
                    url = f"#/orders/{target.order_id}"
                data["links"].append({"id": link.pk, "resource": link.resource, "object_id": link.object_id,
                                      "label": str(target) if target else f"{link.resource} #{link.object_id}", "url": url})
        return data


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_active", "version", "password", "date_joined"]
        read_only_fields = ["id", "version", "date_joined"]

    def validate_email(self, value):
        return value.strip().lower()

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise ValidationError({"password": "Set an initial password."})
        if "password" in attrs:
            try:
                validate_password(attrs["password"], self.instance)
            except DjangoValidationError as exc:
                raise ValidationError({"password": list(exc.messages)})
        if self.instance and self.instance.is_manager and (attrs.get("role") == "dispatcher" or attrs.get("is_active") is False):
            if not User.objects.filter(role="manager", is_active=True).exclude(pk=self.instance.pk).exists():
                raise ValidationError("Keep at least one active manager account.")
        return attrs

    def create(self, data):
        return User.objects.create_user(**data)

    def update(self, instance, data):
        password = data.pop("password", None)
        for key, value in data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


def make_serializer(model):
    readonly = ["id", "created_at", "updated_at", "version", "quick_entry"]
    if model in {Order, Stop, Trip, Visit, Attempt, Review}:
        readonly += ["status"]
    if model is Order:
        readonly += ["client_snapshot", "return_pending", "cancellation_reason", "resolution"]
    if model is Country:
        readonly += ["aliases", "is_custom"]
    if model is Trip:
        readonly += ["started_at", "finished_at", "end_reason"]
    if model is Attempt:
        readonly += ["is_current", "completed_at", "reason"]
    if model is Leg:
        readonly += ["ended_at", "is_cancelled"]
    if model is Visit:
        readonly += ["arrived_at", "departed_at"]
    if model is Review:
        readonly += [field.name for field in model._meta.fields]
    return type(f"{model.__name__}Serializer", (RecordSerializer,), {"Meta": type("Meta", (), {"model": model, "fields": "__all__", "read_only_fields": readonly})})


class ResourceViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    model = None

    def get_queryset(self):
        model = self.model
        queryset = model.objects.all()
        foreign_keys = [field.name for field in model._meta.fields if field.many_to_one]
        if foreign_keys:
            queryset = queryset.select_related(*foreign_keys)
        if model is Order:
            queryset = queryset.prefetch_related("stops__attempts__visit", "customs_visits", Prefetch("legs", queryset=Leg.objects.select_related("trip__vehicle", "trip__driver").order_by("sequence", "pk")))
        if model is Visit:
            queryset = queryset.prefetch_related("orders")
        for key in ["client", "partner", "order", "trip", "stop", "visit", "dispatcher", "vehicle", "driver"]:
            if key in self.request.query_params and any(field.name == key for field in model._meta.fields):
                try:
                    queryset = queryset.filter(**{key + "_id": int(self.request.query_params[key])})
                except ValueError:
                    raise ValidationError({key: "Use a numeric record ID."})
        if "status" in self.request.query_params and any(field.name == "status" for field in model._meta.fields):
            queryset = queryset.filter(status__in=self.request.query_params["status"].split(","))
        if model is Document and self.request.query_params.get("linked_resource"):
            try:
                queryset = queryset.filter(links__resource=self.request.query_params["linked_resource"],
                                           links__object_id=int(self.request.query_params.get("linked_id", ""))).distinct()
            except ValueError:
                raise ValidationError("Use a numeric linked record ID.")
        if model is Document and self.request.query_params.get("trip"):
            try:
                trip_id = int(self.request.query_params["trip"])
            except ValueError:
                raise ValidationError("Use a numeric trip ID.")
            queryset = queryset.filter(pk__in=trip_document_ids(trip_id))
        if model in {Stop, Attempt} and self.request.query_params.get("trip"):
            try:
                trip_id = int(self.request.query_params["trip"])
            except ValueError:
                raise ValidationError("Use a numeric trip ID.")
            queryset = queryset.filter(**({"order__legs__trip_id": trip_id, "order__legs__is_cancelled": False} if model is Stop else {"visit__trip_id": trip_id})).distinct()
        if model is Attempt and self.request.query_params.get("order"):
            try:
                queryset = queryset.filter(stop__order_id=int(self.request.query_params["order"]))
            except ValueError:
                raise ValidationError("Use a numeric order ID.")
        if model is Order:
            for param, lookup in [("received_from", "date_received__gte"), ("received_to", "date_received__lte")]:
                if self.request.query_params.get(param):
                    try:
                        from datetime import date
                        date.fromisoformat(self.request.query_params[param])
                    except ValueError:
                        raise ValidationError({param: "Use YYYY-MM-DD."})
                    queryset = queryset.filter(**{lookup: self.request.query_params[param]})
        term = self.request.query_params.get("q", "").strip()
        if term:
            query = Q()
            for field in model._meta.fields:
                if isinstance(field, (type(Client._meta.get_field("name")), type(Client._meta.get_field("notes")))):
                    query |= Q(**{field.name + "__icontains": term})
            if term.upper().startswith(("ORD-", "TRP-")) and term.split("-")[-1].isdigit():
                query |= Q(pk=int(term.split("-")[-1]))
            if model is Order:
                query |= (Q(client__name__icontains=term) | Q(client_snapshot__name__icontains=term) |
                          Q(legs__trip__vehicle__registration__icontains=term) | Q(legs__trip__starting_code__icontains=term) |
                          Q(stops__short_code__icontains=term) | Q(stops__postal_code__icontains=term) |
                          Q(customs_visits__short_code__icontains=term))
            if query:
                queryset = queryset.filter(query).distinct()
        return queryset

    def create(self, request, *args, **kwargs):
        if self.model in {Review, Handover}:
            raise PermissionDenied("Create this record through its workflow action.")
        data = request.data.copy()
        if self.model in {Order, Trip}:
            if not data.get("dispatcher"):
                data["dispatcher"] = request.user.pk
        with mutation():
            serializer = self.get_serializer(data=data)
            serializer.is_valid(raise_exception=True)
            if self.model is Attempt:
                obj = plan_attempt(serializer.validated_data["stop"], serializer.validated_data["visit"], request.user)
            else:
                obj = serializer.save()
                audit(obj, request.user, "created")
            response = self.get_serializer(obj).data
            if isinstance(obj, Order) and obj.client_reference:
                response["warnings"] = self.duplicate_warnings(obj)
            return Response(response, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="quick-entry")
    def quick_entry(self, request):
        if self.model is not Order:
            raise ValidationError("Use quick entry through orders.")
        with mutation():
            serializer = QuickEntrySerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            order = create_quick_order(serializer.validated_data, request.user)
            data = self.get_serializer(order).data
            if order.client_reference:
                data["warnings"] = self.duplicate_warnings(order)
            return Response(data, status=201)

    def update(self, request, *args, **kwargs):
        if self.model in {Review, Handover, Attempt}:
            raise PermissionDenied("Update this record through its workflow action.")
        with mutation():
            obj = self.get_object()
            require_version(obj, request.data)
            before = snapshot(obj)
            serializer = self.get_serializer(obj, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            obj = serializer.save(version=obj.version + 1)
            sync_single_point_location(obj, serializer.validated_data, request.user)
            if isinstance(obj, Order) and obj.status != "draft" and any(key in serializer.validated_data for key in ["client", "booking_contact"]):
                from core.workflows import client_snapshot
                obj.client_snapshot = client_snapshot(obj)
                obj.save(update_fields=["client_snapshot"])
            after = snapshot(obj)
            if request.data.get("change_reason"):
                after["change_reason"] = request.data["change_reason"]
            AuditEvent.objects.create(actor=request.user, actor_name=str(request.user), resource=obj._meta.model_name,
                                      object_id=obj.pk, action="updated", before=before, after=after)
            response = self.get_serializer(obj).data
            if isinstance(obj, Order):
                response["warnings"] = self.duplicate_warnings(obj)
            return Response(response)

    @staticmethod
    def duplicate_warnings(order):
        if order.client_id and order.client_reference and Order.objects.filter(client=order.client, client_reference=order.client_reference).exclude(pk=order.pk).exists():
            return ["Another order for this client uses the same reference. Check whether this is intentional."]
        return []

    @action(detail=True, methods=["get"], url_path="completion-preview")
    def completion_preview(self, request, pk=None):
        if self.model is not Order:
            raise ValidationError("Complete a shipment through its order.")
        from orders.completion import completion_preview
        with mutation():
            preview, _ = completion_preview(self.get_object(), request.user)
            return Response(preview)

    @action(detail=False, methods=["get"])
    def notebook(self, request):
        if self.model is not Order:
            raise ValidationError("Open the shipment notebook through orders.")
        queryset, metadata = notebook_query(self.filter_queryset(self.get_queryset()), request.query_params)
        page = self.paginate_queryset(queryset)
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        response.data.update(metadata)
        return response

    @action(detail=True, methods=["get", "post"], url_path="loading-date")
    def loading_date(self, request, pk=None):
        if self.model is not Order:
            raise ValidationError("Set the loading date through its order.")
        with mutation():
            order = self.get_object()
            if request.method == "POST":
                serializer = LoadingDateSerializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                set_loading_date(order, serializer.validated_data, request.user)
            return Response(loading_date_preview(self.get_queryset().get(pk=order.pk)))

    @action(detail=True, methods=["get", "post"], url_path="dispatch-details")
    def dispatch_details(self, request, pk=None):
        if self.model is not Order:
            raise ValidationError("Edit dispatch details through an order.")
        with mutation():
            order = self.get_object()
            if request.method == "GET":
                trips = []
                seen = set()
                for leg in order.legs.filter(is_cancelled=False).select_related("trip").order_by("sequence", "pk"):
                    if leg.trip_id in seen:
                        continue
                    seen.add(leg.trip_id)
                    item = make_serializer(Trip)(leg.trip, context=self.get_serializer_context()).data
                    item["order_references"] = list(dict.fromkeys(link.order.reference for link in leg.trip.legs.filter(is_cancelled=False).select_related("order")))
                    trips.append(item)
                return Response({"version": order.version, "trips": trips})
            serializer = DispatchEditSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            edit_dispatch(order, serializer.validated_data, request.user, make_serializer(Trip), self.get_serializer_context())
            # Drop prefetched assignments so the updated summary reflects this save.
            return Response(self.get_serializer(self.get_queryset().get(pk=order.pk)).data)

    @action(detail=True, methods=["get"], url_path="delete-preview")
    def delete_preview(self, request, pk=None):
        with mutation():
            _, preview, _ = deletion_plan(self.get_object(), request.user)
            return Response(preview)

    def destroy(self, request, *args, **kwargs):
        with mutation():
            obj = self.get_object()
            # Check permissions before accepting version/confirmation input.
            deletion_plan(obj, request.user)
            require_version(obj, request.data)
            delete_record(obj, request.user, request.data.get("confirmation_token"))
            return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def command(self, request, pk=None):
        with mutation():
            obj = self.get_object()
            require_version(obj, request.data)
            command = request.data.get("action", "")
            if not isinstance(command, str):
                raise ValidationError({"action": "Choose a workflow action."})
            if isinstance(obj, Leg) and command == "release":
                if obj.trip.status != "planned" or Attempt.objects.filter(visit__trip=obj.trip, stop__order=obj.order).exclude(status__in=["planned", "cancelled"]).exists():
                    raise ValidationError("Only an unstarted assignment can be released. Record actual work and use a handover for collected goods.")
                for attempt in Attempt.objects.filter(visit__trip=obj.trip, stop__order=obj.order, is_current=True):
                    change(attempt, request.user, "assignment_released", is_current=False, status="cancelled", reason="Planning reassignment")
                    change(attempt.stop, request.user, "awaiting_rescheduling", status="planned")
                change(obj, request.user, "assignment_released", is_cancelled=True, ended_at=timezone.now())
            else:
                perform(obj, command, request.data, request.user)
            return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    def upload(self, request, pk=None):
        if self.model is not Document:
            raise ValidationError("Upload files through a document record.")
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Choose a file."})
        if Path(uploaded.name).suffix.lower() not in FILE_EXTENSIONS:
            raise ValidationError("Use a PDF, image or Word document.")
        if uploaded.size > 30 * 1024 * 1024:
            raise ValidationError("The development upload limit is 30 MB per file.")
        with mutation():
            obj = self.get_object()
            file = DocumentVersion.objects.create(document=obj, file=uploaded, original_name=Path(uploaded.name).name[:250], uploaded_by=request.user)
            change(obj, request.user, "file_uploaded")
            return Response({"file": file.pk, "document": self.get_serializer(obj).data}, status=201)

    @action(detail=True, methods=["post"])
    def link(self, request, pk=None):
        if self.model is not Document:
            raise ValidationError("Use a document record.")
        resource = request.data.get("resource")
        target = RESOURCES.get(resource)
        if resource not in {"orders", "stops", "trips", "visits", "legs", "handovers", "drivers", "vehicles", "partners", "clients"} or not target:
            raise ValidationError("Choose a supported document link.")
        with mutation():
            try:
                target.objects.get(pk=request.data.get("object_id"))
            except (target.DoesNotExist, ValueError, TypeError):
                raise ValidationError("The linked record does not exist.")
            obj = self.get_object()
            DocumentLink.objects.get_or_create(document=obj, resource=resource, object_id=request.data["object_id"])
            change(obj, request.user, "document_linked")
            return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        if self.model is not Document:
            raise ValidationError("Use a document record.")
        obj = self.get_object()
        file = obj.files.filter(pk=request.query_params.get("file")).first() if request.query_params.get("file") else obj.files.first()
        if not file:
            raise ValidationError("This document has no matching file.")
        response = FileResponse(file.file.open("rb"), as_attachment=True, filename=file.original_name)
        response["X-Content-Type-Options"] = "nosniff"
        return response


class UsersViewSet(ResourceViewSet):
    model = User
    serializer_class = UserSerializer

    def get_queryset(self):
        return User.objects.order_by("full_name")

    def get_serializer_class(self):
        if self.request.method == "GET" and not self.request.user.is_manager:
            return type("AssignmentUserSerializer", (serializers.ModelSerializer,), {"Meta": type("Meta", (), {"model": User, "fields": ["id", "full_name", "is_active"]})})
        return UserSerializer

    def create(self, request, *args, **kwargs):
        if not request.user.is_manager:
            raise PermissionDenied("Only managers can create accounts.")
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not request.user.is_manager:
            raise PermissionDenied("Only managers can manage accounts.")
        return super().update(request, *args, **kwargs)


class AuditSerializer(serializers.ModelSerializer):
    changes = serializers.SerializerMethodField()

    def get_changes(self, instance):
        return [{"field": key, "before": instance.before.get(key), "after": val} for key, val in instance.after.items()
                if key not in {"id", "version", "created_at", "updated_at", "last_login"} and instance.before.get(key) != val]

    class Meta:
        model = AuditEvent
        fields = "__all__"


class AuditViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditSerializer

    def get_queryset(self):
        queryset = AuditEvent.objects.all()
        for field in ["resource", "object_id"]:
            if self.request.query_params.get(field):
                queryset = queryset.filter(**{field: self.request.query_params[field]})
        return queryset


router = DefaultRouter()
router.register("users", UsersViewSet, basename="users")
router.register("history", AuditViewSet, basename="history")
for resource, model in RESOURCES.items():
    view = type(model.__name__ + "ViewSet", (ResourceViewSet,), {"model": model, "serializer_class": make_serializer(model)})
    if model is Country:
        view.http_method_names = ["get", "post", "head", "options"]
    router.register(resource, view, basename=resource)


@api_view(["GET"])
@permission_classes([])
def health(request):
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return Response({"status": "ok", "database": "postgresql"})


@api_view(["GET"])
def dashboard(request):
    figures = [financials(trip) for trip in Trip.objects.filter(status="finished")]
    final_margin = sum((Decimal(item["margin"]) for item in figures if not item["provisional"] and item["margin"] is not None), Decimal("0"))
    return Response({"order_count": Order.objects.count(), "open_orders": Order.objects.filter(status__in=["confirmed", "in_progress"]).count(),
                     "active_trips": Trip.objects.filter(status__in=["in_progress", "interrupted"]).count(),
                     "unassigned_trips": Trip.objects.filter(status="planned", vehicle__isnull=True).count(),
                     "usable_vans": Vehicle.objects.filter(status="active").count(), "final_margin": str(final_margin),
                     "pending_reviews": Review.objects.filter(status="pending").count(),
                     "expiring_documents": Document.objects.filter(expires_on__lte=timezone.localdate() + timedelta(days=30)).count(),
                     "order_statuses": {key: Order.objects.filter(status=key).count() for key in ["draft", "confirmed", "in_progress", "delivered", "cancelled"]}})

