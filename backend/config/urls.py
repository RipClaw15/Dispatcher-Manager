from django.contrib import admin
from django.urls import include, path
from core.api import router, dashboard, health
from accounts.views import csrf_token, login_view, logout_view, me
from directory.postcodes import postcode_search

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/csrf/", csrf_token), path("api/auth/login/", login_view),
    path("api/auth/logout/", logout_view), path("api/auth/me/", me),
    path("api/dashboard/", dashboard), path("api/", include(router.urls)),
    path("api/postcodes/", postcode_search),
]

