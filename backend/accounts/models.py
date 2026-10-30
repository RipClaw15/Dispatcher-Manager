from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, role="manager")
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=[("manager", "Manager"), ("dispatcher", "Dispatcher")], default="dispatcher")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    version = models.PositiveIntegerField(default=1)
    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    @property
    def is_manager(self):
        return self.role == "manager"

    def __str__(self):
        return self.full_name or self.email

