from django.http import JsonResponse
from django.urls import include, path

def root_status(request):
    return JsonResponse({
        "service": "StormHaul Routing API",
        "status": "online",
        "health": "/api/health/",
        "endpoints": ["/api/plan/", "/api/locations/", "/api/locations/resolve/"]
    })

urlpatterns = [
    path("", root_status, name="root-status"),
    path("api/", include("planner.urls")),
]
