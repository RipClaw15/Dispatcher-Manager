import json

from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST


def user_data(user):
    return {"id": user.pk, "email": user.email, "full_name": user.full_name, "role": user.role,
            "is_active": user.is_active, "version": user.version}


@require_GET
def csrf_token(request):
    return JsonResponse({"csrfToken": get_token(request)})


@require_POST
@csrf_protect
def login_view(request):
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"detail": "Invalid login request."}, status=400)
    user = authenticate(request, username=str(data.get("email", "")).strip().lower(), password=data.get("password", ""))
    if not user:
        return JsonResponse({"detail": "Email or password is incorrect."}, status=400)
    login(request, user)
    return JsonResponse({"user": user_data(user), "csrfToken": get_token(request)})


@require_POST
@csrf_protect
def logout_view(request):
    logout(request)
    return JsonResponse({"detail": "Signed out."})


@require_GET
def me(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Please sign in."}, status=401)
    return JsonResponse(user_data(request.user))

