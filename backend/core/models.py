from django.conf import settings
from django.db import models


class Record(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        abstract = True
        ordering = ["-id"]


class AuditEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=200)
    resource = models.CharField(max_length=80)
    object_id = models.PositiveBigIntegerField()
    action = models.CharField(max_length=80)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]

