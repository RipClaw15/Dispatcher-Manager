"""Daily shipment notebook, based on the first loading stop's planned date."""
import calendar
import re
from datetime import date

from django.db.models import Case, DateField, IntegerField, OuterRef, Q, Subquery, Value, When
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from core.workflows import Conflict, change, require_version
from directory.countries import country_lookup
from orders.models import Stop
from trips.models import Leg


def first_collection(order):
    collections = [stop for stop in order.stops.all() if stop.kind == "collection"]
    active = [stop for stop in collections if stop.status != "cancelled"]
    return next(iter(active or collections), None)


def with_loading_date(queryset):
    first = Stop.objects.filter(order_id=OuterRef("pk"), kind="collection").annotate(
        cancelled_sort=Case(When(status="cancelled", then=Value(1)), default=Value(0), output_field=IntegerField())
    ).order_by("cancelled_sort", "position", "pk")
    return queryset.annotate(loading_date=Subquery(first.values("planned_date")[:1], output_field=DateField()))


def country_condition(value):
    lookup = country_lookup()
    descriptor = lookup.get(value.strip().casefold())
    variants = [key for key, country in lookup.items() if descriptor and country["key"] == descriptor["key"]] or [value.strip()]
    condition = Q()
    for variant in variants:
        condition |= Q(country__iexact=variant)
    prefixes = [variant for variant in variants if len(variant) == 2 and variant.isascii() and variant.isalpha()]
    if descriptor and descriptor["code"] and prefixes:
        pattern = r"^\s*(" + "|".join(re.escape(prefix) for prefix in prefixes) + r")([0-9\s-]|$)"
        condition |= Q(country="", short_code__iregex=pattern)
    return condition


def notebook_query(queryset, params):
    today = timezone.localdate()
    scope = params.get("scope", "month")
    if scope not in {"month", "undated"}:
        raise ValidationError({"scope": "Choose month or undated."})
    queryset = with_loading_date(queryset)
    vehicle = params.get("vehicle")
    if vehicle:
        if vehicle == "unassigned":
            queryset = queryset.exclude(pk__in=Leg.objects.filter(is_cancelled=False, trip__vehicle__isnull=False).values("order_id"))
        else:
            try:
                vehicle_id = int(vehicle)
            except ValueError:
                raise ValidationError({"vehicle": "Choose a van or unassigned."})
            queryset = queryset.filter(legs__is_cancelled=False, legs__trip__vehicle_id=vehicle_id)
    for field, kind in [("loading_country", "collection"), ("delivery_country", "delivery")]:
        if params.get(field):
            stops = Stop.objects.filter(kind=kind).filter(Q(order__status="cancelled") | ~Q(status="cancelled")).filter(country_condition(params[field]))
            queryset = queryset.filter(pk__in=stops.values("order_id"))
    queryset = queryset.distinct()
    latest_date = None
    if not params.get("month"):
        latest_date = queryset.filter(loading_date__isnull=False).order_by("-loading_date").values_list("loading_date", flat=True).first()
    month = params.get("month") or (latest_date or today).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValidationError({"month": "Use YYYY-MM."})
    try:
        year, number = map(int, month.split("-"))
        start = date(year, number, 1)
        end = date(year, number, calendar.monthrange(year, number)[1])
    except ValueError:
        raise ValidationError({"month": "Choose a valid calendar month."})
    undated_count = queryset.filter(loading_date__isnull=True).count()
    month_orders = queryset.filter(loading_date__range=(start, end))
    metadata = {"today": today.isoformat(), "month": month, "scope": scope,
                "undated_count": undated_count, "month_count": month_orders.count(),
                "upcoming_count": month_orders.filter(loading_date__gt=today).count()}
    selected = queryset.filter(loading_date__isnull=True) if scope == "undated" else month_orders
    return selected.order_by("-loading_date", "-pk"), metadata


def loading_date_preview(order):
    stop = first_collection(order)
    return {"version": order.version, "stop": {
        "id": stop.pk, "version": stop.version, "label": str(stop),
        "planned_date": stop.planned_date, "timing": stop.timing,
        "time_from": stop.time_from, "time_to": stop.time_to,
    } if stop else None}


class LoadingDateSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    stop = serializers.IntegerField(min_value=1)
    stop_version = serializers.IntegerField(min_value=1)
    planned_date = serializers.DateField(allow_null=True)


def set_loading_date(order, data, user):
    require_version(order, data)
    stop = first_collection(order)
    if not stop:
        raise ValidationError("Add a collection stop to this order before setting its loading date.")
    if stop.pk != data["stop"]:
        raise Conflict("The first collection changed. Review the latest loading stop before saving.")
    require_version(stop, {"version": data["stop_version"]})
    values = {"planned_date": data["planned_date"]}
    if data["planned_date"] is None:
        values.update(timing="unknown", time_from=None, time_to=None)
    elif stop.timing == "unknown":
        values["timing"] = "date"
    change(stop, user, "loading_date_updated", **values)
    change(order, user, "loading_date_updated")
