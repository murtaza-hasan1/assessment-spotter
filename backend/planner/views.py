import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .services import InputError, ProviderError, build_trip_plan, resolve_location, reverse_geocode_location, search_locations


@require_GET
def health(_request):
    return JsonResponse({"status": "ok", "routing_configured": bool(settings.TOMTOM_API_KEY)})


@require_GET
def location_suggestions(request):
    query = request.GET.get("q", "")
    try:
        bias = {"lat": request.GET.get("bias_lat"), "lon": request.GET.get("bias_lon")} if request.GET.get("bias_lat") and request.GET.get("bias_lon") else None
        suggestions = search_locations(query, settings.TOMTOM_API_KEY, request.GET.get("session_id", ""), bias,
                                       mapbox_key=settings.MAPBOX_ACCESS_TOKEN,
                                       full_address=request.GET.get("full_address") == "true")
        return JsonResponse({"suggestions": suggestions})
    except InputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except ProviderError as exc:
        return JsonResponse({"error": str(exc)}, status=502)


@require_GET
def location_details(request):
    selection = {
        "id": request.GET.get("id"), "label": request.GET.get("label", ""),
        "title": request.GET.get("title", ""), "detailsType": request.GET.get("type"),
        "detailsId": request.GET.get("details_id"), "lat": request.GET.get("lat"),
        "lon": request.GET.get("lon"), "country": request.GET.get("country", ""),
    }
    try:
        place = resolve_location(selection, settings.TOMTOM_API_KEY, request.GET.get("session_id", ""))
        return JsonResponse({"place": place})
    except InputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except ProviderError as exc:
        return JsonResponse({"error": str(exc)}, status=502)


@require_GET
def location_reverse(request):
    try:
        label = reverse_geocode_location(
            request.GET.get("lat"), request.GET.get("lon"), settings.MAPBOX_ACCESS_TOKEN
        )
        return JsonResponse({"label": label})
    except InputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except ProviderError as exc:
        return JsonResponse({"error": str(exc)}, status=502)


@csrf_exempt
@require_POST
def plan_trip(request):
    try:
        payload = json.loads(request.body or b"{}")
        result = build_trip_plan(payload, settings.TOMTOM_API_KEY)
        return JsonResponse(result)
    except InputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except ProviderError as exc:
        return JsonResponse({"error": str(exc)}, status=502)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)
