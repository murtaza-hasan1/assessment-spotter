from django.urls import path

from .views import health, location_details, location_reverse, location_suggestions, plan_trip

urlpatterns = [
    path("health/", health, name="health"),
    path("locations/", location_suggestions, name="location-suggestions"),
    path("locations/resolve/", location_details, name="location-details"),
    path("locations/reverse/", location_reverse, name="location-reverse"),
    path("plan/", plan_trip, name="plan-trip"),
]
