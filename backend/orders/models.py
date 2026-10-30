from django.conf import settings
from django.db import models
from django.utils import timezone
from core.models import Record


class Order(Record):
    quick_entry = models.BooleanField(default=False)
    client = models.ForeignKey("directory.Client", on_delete=models.PROTECT, null=True, blank=True, related_name="orders")
    dispatcher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    booking_contact = models.ForeignKey("directory.Contact", on_delete=models.SET_NULL, null=True, blank=True)
    client_reference = models.CharField(max_length=180, blank=True)
    date_received = models.DateField(default=timezone.localdate)
    price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=[(v, v.replace("_", " ").title()) for v in ["draft", "confirmed", "in_progress", "delivered", "cancelled"]], default="draft")
    notes = models.TextField(blank=True)
    client_snapshot = models.JSONField(default=dict, blank=True)
    customs_required = models.BooleanField(default=False)
    return_pending = models.BooleanField(default=False)
    cancellation_reason = models.TextField(blank=True)
    resolution = models.CharField(max_length=100, blank=True)

    @property
    def reference(self):
        return f"ORD-{self.pk:06d}"

    def __str__(self):
        return self.reference if self.pk else "New order"


class Stop(Record):
    short_code = models.CharField(max_length=40, blank=True)
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="stops")
    kind = models.CharField(max_length=20, choices=[("collection", "Collection"), ("delivery", "Delivery"), ("return", "Return")])
    position = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=30, default="planned")
    location_name = models.CharField(max_length=200, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=120, blank=True)
    postal_code = models.CharField(max_length=40, blank=True)
    country = models.CharField(max_length=80, blank=True)
    location_confirmed = models.BooleanField(default=False)
    contact_name = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=80, blank=True)
    external_reference = models.CharField(max_length=180, blank=True)
    instructions = models.TextField(blank=True)
    timing = models.CharField(max_length=20, choices=[("unknown", "Unknown"), ("date", "Date only"), ("window", "Time window"), ("appointment", "Appointment")], default="unknown")
    planned_date = models.DateField(null=True, blank=True)
    time_from = models.TimeField(null=True, blank=True)
    time_to = models.TimeField(null=True, blank=True)
    timezone = models.CharField(max_length=80, blank=True)
    reason = models.TextField(blank=True)
    return_of = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True)

    class Meta(Record.Meta):
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.kind.title()}: {self.short_code or self.location_name or self.city or self.postal_code}"


class Cargo(Record):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="cargo")
    collection = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="cargo_collected")
    delivery = models.ForeignKey(Stop, on_delete=models.PROTECT, related_name="cargo_delivered")
    description = models.CharField(max_length=250)
    reported = models.JSONField(default=dict, blank=True)
    actual = models.JSONField(default=dict, blank=True)
    details_confirmed = models.BooleanField(default=False)
    instructions = models.TextField(blank=True)

    def __str__(self):
        return self.description

