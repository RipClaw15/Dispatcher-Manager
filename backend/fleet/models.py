from django.db import models
from core.models import Record


class Vehicle(Record):
    partner = models.ForeignKey("directory.Partner", on_delete=models.PROTECT, null=True, blank=True, related_name="vehicles")
    registration = models.CharField(max_length=50)
    registration_country = models.CharField(max_length=80)
    vehicle_type = models.CharField(max_length=60, default="Box van")
    default_rate = models.DecimalField(max_digits=8, decimal_places=4)
    make_model = models.CharField(max_length=150, blank=True)
    payload_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    length_cm = models.DecimalField(max_digits=8, decimal_places=1, null=True, blank=True)
    width_cm = models.DecimalField(max_digits=8, decimal_places=1, null=True, blank=True)
    height_cm = models.DecimalField(max_digits=8, decimal_places=1, null=True, blank=True)
    pallet_capacity = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=30, choices=[("active", "Active"), ("out_of_service", "Out of service"), ("inactive", "Inactive")], default="active")
    available_at = models.DateTimeField(null=True, blank=True)
    available_region = models.CharField(max_length=180, blank=True)
    available_country = models.CharField(max_length=80, blank=True)
    availability_estimated = models.BooleanField(default=True)

    class Meta(Record.Meta):
        constraints = [models.UniqueConstraint(fields=["registration", "registration_country"], name="vehicle_registration_country"),
                       models.CheckConstraint(condition=models.Q(default_rate__gte=0), name="vehicle_rate_nonnegative")]

    def __str__(self):
        return self.registration


class Driver(Record):
    partner = models.ForeignKey("directory.Partner", on_delete=models.PROTECT, null=True, blank=True, related_name="drivers")
    full_name = models.CharField(max_length=200)
    citizenship = models.CharField(max_length=80, blank=True)
    phone = models.CharField(max_length=80)
    email = models.EmailField(blank=True)
    usual_vehicle = models.ForeignKey(Vehicle, on_delete=models.SET_NULL, null=True, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.full_name

