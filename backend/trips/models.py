from django.conf import settings
from django.db import models
from core.models import Record


class Trip(Record):
    quick_entry = models.BooleanField(default=False)
    starting_code = models.CharField(max_length=40, blank=True)
    starting_country = models.CharField(max_length=80, blank=True)
    name = models.CharField(max_length=200, blank=True)
    dispatcher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="trips")
    partner = models.ForeignKey("directory.Partner", on_delete=models.PROTECT, null=True, blank=True)
    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.PROTECT, null=True, blank=True)
    driver = models.ForeignKey("fleet.Driver", on_delete=models.PROTECT, null=True, blank=True)
    status = models.CharField(max_length=25, default="planned")
    rate = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    rate_reason = models.CharField(max_length=250, blank=True)
    estimated_km = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    actual_km = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    planned_start = models.DateTimeField(null=True, blank=True)
    planned_end = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    end_reason = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    @property
    def reference(self):
        return f"TRP-{self.pk:06d}"

    def __str__(self):
        return self.reference if self.pk else "New trip"


class Leg(Record):
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="legs")
    trip = models.ForeignKey(Trip, on_delete=models.PROTECT, related_name="legs")
    sequence = models.PositiveIntegerField(default=1)
    allocated_revenue = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    is_cancelled = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.order.reference} / {self.trip.reference}"

    class Meta(Record.Meta):
        constraints = [models.UniqueConstraint(fields=["order", "trip"], condition=models.Q(ended_at__isnull=True, is_cancelled=False), name="order_one_active_leg_per_trip")]


class Visit(Record):
    short_code = models.CharField(max_length=40, blank=True)
    trip = models.ForeignKey(Trip, on_delete=models.PROTECT, related_name="visits")
    position = models.PositiveIntegerField(default=1)
    kind = models.CharField(max_length=20, choices=[("work", "Collection / delivery"), ("customs", "Customs checkpoint"), ("handover", "Handover")], default="work")
    status = models.CharField(max_length=20, default="planned")
    location_name = models.CharField(max_length=200, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=120, blank=True)
    postal_code = models.CharField(max_length=40, blank=True)
    country = models.CharField(max_length=80, blank=True)
    timezone = models.CharField(max_length=80, blank=True)
    planned_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    departed_at = models.DateTimeField(null=True, blank=True)
    instructions = models.TextField(blank=True)
    orders = models.ManyToManyField("orders.Order", blank=True, related_name="customs_visits")

    def __str__(self):
        return f"{self.trip.reference} · {self.short_code or self.location_name or self.city or self.postal_code or self.kind}"

    class Meta(Record.Meta):
        ordering = ["position", "id"]


class Attempt(Record):
    stop = models.ForeignKey("orders.Stop", on_delete=models.PROTECT, related_name="attempts")
    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, related_name="attempts")
    status = models.CharField(max_length=25, default="planned")
    is_current = models.BooleanField(default=True)
    reason = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta(Record.Meta):
        constraints = [models.UniqueConstraint(fields=["stop"], condition=models.Q(is_current=True), name="one_current_stop_attempt")]


class Extra(Record):
    trip = models.ForeignKey(Trip, on_delete=models.PROTECT, related_name="extras")
    description = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=14, decimal_places=2)


class Handover(Record):
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="handovers")
    from_leg = models.ForeignKey(Leg, on_delete=models.PROTECT, related_name="outgoing_handovers")
    to_leg = models.ForeignKey(Leg, on_delete=models.PROTECT, related_name="incoming_handovers")
    location = models.CharField(max_length=250)
    occurred_at = models.DateTimeField()
    reason = models.TextField()
    is_emergency = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.order.reference} handover · {self.location}"

