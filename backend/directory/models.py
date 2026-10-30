from django.db import models
from django.db.models.functions import Lower
from core.models import Record


class Country(Record):
    name = models.CharField(max_length=80)
    code = models.CharField(max_length=6, blank=True)
    aliases = models.JSONField(default=list, blank=True)
    is_custom = models.BooleanField(default=True)

    class Meta(Record.Meta):
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="country_name_insensitive"),
            models.UniqueConstraint(Lower("code"), condition=~models.Q(code=""), name="country_code_insensitive"),
            models.CheckConstraint(condition=models.Q(code="") | models.Q(code__regex=r"^[A-Z]{2}(-[A-Z]{3})?$"), name="country_or_region_code"),
        ]

    def __str__(self):
        return self.name


class PostalDataset(models.Model):
    country_code = models.CharField(max_length=2, primary_key=True)
    imported_at = models.DateTimeField(null=True, blank=True)
    source_url = models.URLField(blank=True)
    checksum = models.CharField(max_length=64, blank=True)
    row_count = models.PositiveIntegerField(default=0)
    provider_name = models.CharField(max_length=80, default="GeoNames")
    provider_url = models.URLField(default="https://www.geonames.org/")
    license_name = models.CharField(max_length=80, default="CC BY 4.0")
    coverage_note = models.TextField(blank=True)
    postcode_precision = models.CharField(max_length=12, default="postcode")


class PostalPlace(models.Model):
    dataset = models.ForeignKey(PostalDataset, on_delete=models.CASCADE, related_name="places")
    postal_code = models.CharField(max_length=20)
    place_name = models.CharField(max_length=180, blank=True)
    admin_name = models.CharField(max_length=100, blank=True)
    search_name = models.CharField(max_length=180, blank=True)
    search_postcode = models.CharField(max_length=20, blank=True, db_collation="C")

    class Meta:
        ordering = ["postal_code", "place_name", "id"]
        indexes = [models.Index(fields=["dataset", "postal_code"], name="postal_country_code_idx")]
        indexes += [models.Index(fields=["dataset", "search_postcode"], name="postal_normalized_code_idx")]
        constraints = [models.UniqueConstraint(fields=["dataset", "postal_code", "place_name", "admin_name"], name="postal_place_unique")]


class Business(Record):
    name = models.CharField(max_length=200)
    country = models.CharField(max_length=80)
    legal_name = models.CharField(max_length=250, blank=True)
    address = models.TextField(blank=True)
    tax_id = models.CharField(max_length=100, blank=True)
    registration_number = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(Record.Meta):
        abstract = True

    def __str__(self):
        return self.name


class Client(Business):
    pass


class Partner(Business):
    pass


class Contact(Record):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, null=True, blank=True, related_name="contacts")
    partner = models.ForeignKey(Partner, on_delete=models.PROTECT, null=True, blank=True, related_name="contacts")
    name = models.CharField(max_length=200)
    role = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=80, blank=True)

    class Meta(Record.Meta):
        constraints = [models.CheckConstraint(condition=(models.Q(client__isnull=False, partner__isnull=True) |
                                                        models.Q(client__isnull=True, partner__isnull=False)), name="contact_one_business")]

    def __str__(self):
        return self.name


class Location(Record):
    name = models.CharField(max_length=200)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=120, blank=True)
    postal_code = models.CharField(max_length=40, blank=True)
    country = models.CharField(max_length=80, blank=True)
    timezone = models.CharField(max_length=80, blank=True)
    contact_name = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=80, blank=True)
    opening_hours = models.CharField(max_length=250, blank=True)
    instructions = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name

