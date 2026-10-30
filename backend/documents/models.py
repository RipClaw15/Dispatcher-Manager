import uuid
from pathlib import Path
from django.conf import settings
from django.db import models
from core.models import Record


def private_path(instance, filename):
    return f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class Document(Record):
    title = models.CharField(max_length=250)
    kind = models.CharField(max_length=50, default="other")
    notes = models.TextField(blank=True)
    valid_from = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)


class DocumentVersion(models.Model):
    document = models.ForeignKey(Document, on_delete=models.PROTECT, related_name="files")
    file = models.FileField(upload_to=private_path)
    original_name = models.CharField(max_length=250)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class DocumentLink(models.Model):
    document = models.ForeignKey(Document, on_delete=models.PROTECT, related_name="links")
    resource = models.CharField(max_length=50)
    object_id = models.PositiveBigIntegerField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["document", "resource", "object_id"], name="unique_document_link")]

