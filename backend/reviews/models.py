from django.conf import settings
from django.db import models
from core.models import Record


class Review(Record):
    kind = models.CharField(max_length=30, choices=[("reopen_order", "Reopen delivered order"), ("handover", "Handover review"), ("enroute_cancel", "En-route cancellation review")])
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="reviews")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="requested_reviews")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="decided_reviews")
    status = models.CharField(max_length=20, default="pending")
    reason = models.TextField()
    decision_note = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

