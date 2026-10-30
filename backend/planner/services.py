"""Provider adapters and deterministic risk calculations for the planner API."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from math import asin, ceil, cos, isfinite, radians, sin, sqrt

import requests
from django.core.cache import cache
from django.utils.dateparse import parse_datetime

TOMTOM_BASE = "https://api.tomtom.com"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
MILES_TO_METERS = 1609.344
METERS_TO_MILES = 1 / MILES_TO_METERS
HEAT_SPACING_MILES = 15
MAX_COORDS_PER_CALL = 40


class InputError(ValueError):
    pass


class ProviderError(RuntimeError):
    pass


def _get_json(url, *, params, timeout=25):
    cache_material = json.dumps([url, params], sort_keys=True, separators=(",", ":"))
    cache_key = "provider:" + hashlib.sha256(cache_material.encode("utf-8")).hexdigest()
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        response = requests.get(url, params=params, timeout=timeout)
        response.raise_for_status()
        body = response.json()
        cache.set(cache_key, body, 600 if "open-meteo.com" in url else 3600)
        return body
    except requests.HTTPError as exc:
        response = exc.response
        if "/routing/1/calculateRoute/" in url and response is not None and response.status_code in (400, 404, 422):
            raise InputError("TomTom could not find a truck-legal route for these addresses. Choose a nearby street or truck entrance and try again.") from exc
        raise ProviderError("A weather or routing provider request failed. Please try again shortly.") from exc
    except (requests.RequestException, ValueError) as exc:
        raise ProviderError("A weather or routing provider request failed. Please try again shortly.") from exc


def _required_text(data, field, label):
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"Enter a valid {label}.")
    return value.strip()


def _selected_location(data, field, label):
    place = data.get(field)
    if not isinstance(place, dict):
        raise InputError(f"Select a {label} from the address suggestions.")
    name = place.get("label")
    if not isinstance(name, str) or not name.strip():
        raise InputError(f"Select a valid {label} from the address suggestions.")
    try:
        lat = float(place.get("lat"))
        lon = float(place.get("lon"))
    except (TypeError, ValueError):
        raise InputError(f"Select a valid {label} from the address suggestions.")
    if not isfinite(lat) or not isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise InputError(f"Select a valid {label} from the address suggestions.")
    return {
        "lat": lat,
        "lon": lon,
        "label": name.strip(),
        "country": str(place.get("country") or ""),
        "isCurrentLocation": bool(place.get("isCurrentLocation")),
        "accuracyMeters": place.get("accuracyMeters"),
    }


def validate_payload(data):
    if not isinstance(data, dict):
        raise InputError("Request body must be a JSON object.")
    origin = _selected_location(data, "origin", "origin")
    destination = _selected_location(data, "destination", "destination")
    if haversine(origin, destination) < 5:
        raise InputError("Origin and destination are the same location. Choose two different places.")
    departure_raw = _required_text(data, "departure", "departure date and time")
    try:
        departure = parse_datetime(departure_raw)
    except (TypeError, ValueError):
        departure = None
    if departure is None or departure.tzinfo is None:
        raise InputError("Choose a departure date and time with a time zone.")
    departure = departure.astimezone(timezone.utc)
    now = datetime.now(timezone.utc)
    if departure <= now:
        raise InputError("Departure time must be in the future.")
    if departure > now + timedelta(days=14):
        raise InputError("Choose a departure within the next 14 days so a forecast is available.")
    try:
        load_lbs = float(data.get("loadWeight"))
    except (TypeError, ValueError):
        raise InputError("Enter a valid load weight in pounds.")
    if not 0 <= load_lbs <= 200000:
        raise InputError("Load weight must be between 0 and 200,000 lb.")
    try:
        spacing = int(data.get("spacingMiles", 25))
    except (TypeError, ValueError):
        spacing = 0
    if spacing not in (10, 25, 50):
        raise InputError("Checkpoint spacing must be 10, 25, or 50 miles.")
    return origin, destination, departure, load_lbs, spacing


def _provider_get(url, *, params=None, headers=None, timeout=15):
    try:
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        raise ProviderError("Address search is temporarily unavailable. Please try again shortly.") from exc


def _legacy_location_search(query, api_key, *, limit=10, typeahead=True):
    result = _get_json(
        f"{TOMTOM_BASE}/search/2/search/{requests.utils.quote(query, safe='')}.json",
        params={"key": api_key, "typeahead": str(typeahead).lower(), "limit": limit, "maxFuzzyLevel": 4, "language": "en-US"},
    )
    suggestions = []
    for hit in result.get("results") or []:
        position = hit.get("position") or {}
        address = hit.get("address") or {}
        poi_name = (hit.get("poi") or {}).get("name")
        address_label = address.get("freeformAddress")
        label = f"{poi_name} — {address_label}" if poi_name and address_label else poi_name or address_label
        if not label or position.get("lat") is None or position.get("lon") is None:
            continue
        suggestions.append({
            "id": hit.get("id"), "label": label, "title": poi_name or label,
            "subtitle": address_label if poi_name else "",
            "lat": position["lat"], "lon": position["lon"],
            "type": hit.get("type", "Address"),
            "country": address.get("country") or address.get("countryCode") or "",
            "source": "TomTom",
        })
    return suggestions


def _mapbox_location_search(query, api_key, bias_location=None, *, full_address=False):
    if not api_key:
        return []
    params = {
        "q": query,
        "access_token": api_key,
        "limit": 10,
        "language": "en",
        "autocomplete": "false" if full_address else "true",
    }
    if bias_location:
        try:
            lat, lon = float(bias_location["lat"]), float(bias_location["lon"])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                params["proximity"] = f"{lon},{lat}"
        except (KeyError, TypeError, ValueError):
            pass
    try:
        result = _provider_get("https://api.mapbox.com/search/geocode/v6/forward", params=params)
    except ProviderError:
        return []
    suggestions = []
    for feature in result.get("features") or []:
        properties = feature.get("properties") or {}
        try:
            lon, lat = map(float, feature["geometry"]["coordinates"][:2])
        except (KeyError, TypeError, ValueError):
            continue
        context = properties.get("context") or {}
        country = context.get("country") or {}
        label = str(properties.get("full_address") or ", ".join(
            part for part in (properties.get("name"), properties.get("place_formatted")) if part
        )).strip()
        if not label:
            continue
        suggestions.append({
            "id": f"mapbox:{properties.get('mapbox_id') or f'{lat},{lon}'}",
            "label": label,
            "title": properties.get("name") or label,
            "subtitle": properties.get("place_formatted") or "",
            "lat": lat,
            "lon": lon,
            "type": properties.get("feature_type") or "address",
            "country": country.get("name") or country.get("country_code") or "",
            "source": "Mapbox",
            "confidence": (properties.get("match_code") or {}).get("confidence"),
        })
    return suggestions


def reverse_geocode_location(latitude, longitude, api_key):
    """Resolve a readable current-location label without persisting Mapbox results."""
    if not api_key:
        return None
    try:
        latitude, longitude = float(latitude), float(longitude)
    except (TypeError, ValueError):
        raise InputError("Current location coordinates are invalid.")
    if not isfinite(latitude) or not isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise InputError("Current location coordinates are invalid.")

    try:
        result = _provider_get(
            "https://api.mapbox.com/search/geocode/v6/reverse",
            params={
                "longitude": longitude,
                "latitude": latitude,
                "access_token": api_key,
                "language": "en",
                "types": "address,street,neighborhood,locality,place",
            },
        )
    except ProviderError:
        return None

    features = result.get("features") or []
    priority = {"address": 0, "street": 1, "neighborhood": 2, "locality": 3, "place": 4}
    features.sort(key=lambda feature: priority.get((feature.get("properties") or {}).get("feature_type"), 5))
    for feature in features:
        properties = feature.get("properties") or {}
        label = properties.get("full_address") or ", ".join(
            part for part in (properties.get("name"), properties.get("place_formatted")) if part
        )
        if label:
            return str(label).strip()
    return None


def _merge_location_results(*groups, limit=20):
    merged = []
    seen = set()
    for group in groups:
        for item in group:
            identity = "".join(str(item.get("label", "")).casefold().split())
            if identity and identity not in seen:
                merged.append(item)
                seen.add(identity)
    return merged[:limit]


def _matches_detailed_address_context(query, suggestion):
    words = re.findall(r"[a-z0-9]+", query.casefold())
    levels = re.findall(r"\b(phase|sector|block)\s*[-:#]?\s*([a-z0-9]+)\b", query.casefold())
    if query.count(",") < 2 and len(levels) < 2:
        return True

    result_text = str(suggestion.get("label") or "").casefold()
    result_words = set(re.findall(r"[a-z0-9]+", result_text))
    generic = {
        "house", "home", "number", "no", "street", "st", "road", "rd", "avenue", "ave",
        "lane", "sector", "sec", "phase", "block", "plot", "building", "unit", "flat",
        "apartment", "apt", "near", "the", "and", "of", "in", "at", "to", "by",
    }
    required_location_words = {word for word in words if len(word) >= 3 and not word.isdigit() and word not in generic}
    if not required_location_words.issubset(result_words):
        return False

    compact_result = re.sub(r"[^a-z0-9]", "", result_text)
    return all(f"{level}{value}" in compact_result for level, value in levels)


def search_locations(query, api_key, session_id="", bias_location=None, *, mapbox_key="", full_address=False):
    query = query.strip()
    if len(query) < 2:
        return []
    if not api_key and not mapbox_key:
        raise ProviderError("Address search is not configured yet. Add a TomTom or Mapbox key to the backend environment.")
    mapbox_suggestions = _mapbox_location_search(query, mapbox_key, bias_location, full_address=full_address)
    mapbox_suggestions = [item for item in mapbox_suggestions if _matches_detailed_address_context(query, item)]
    if full_address:
        tomtom_suggestions = []
        if api_key:
            try:
                tomtom_suggestions = _legacy_location_search(query, api_key, limit=20, typeahead=False)
            except ProviderError:
                pass
        return _merge_location_results(mapbox_suggestions, tomtom_suggestions)

    suggestions = list(mapbox_suggestions)
    headers = {"TomTom-Api-Key": api_key, "TomTom-Api-Version": "3", "Session-Id": session_id,
               "Content-Type": "application/json", "Attributes": "results(id,type,title,subtitles,more(operation,pathParameters))"}
    body = {"query": query, "maxResults": 10, "filters": {"types": ["poi", "address", "street", "intersection", "area"]}}
    if bias_location:
        try:
            lat, lon = float(bias_location["lat"]), float(bias_location["lon"])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                body["preferences"] = {"geometry": {"type": "point", "coordinates": [lon, lat]}}
        except (KeyError, TypeError, ValueError):
            pass
    if api_key and len(suggestions) < 10:
        try:
            response = requests.post("https://api.tomtom.com/maps/orbis/places/suggest", json=body, headers=headers, timeout=15)
            response.raise_for_status()
            result = response.json()
            for item in result.get("results") or []:
                title = item.get("title") or ""
                subtitles = item.get("subtitles") or []
                subtitle = ", ".join(str(part) for part in subtitles if part)
                more = item.get("more") or {}
                path = more.get("pathParameters") or []
                path_parameters = {entry.get("parameter"): entry.get("argument") for entry in path if isinstance(entry, dict)} if isinstance(path, list) else path
                detail_type, detail_id = path_parameters.get("type"), path_parameters.get("id")
                if title:
                    suggestions.append({"id": item.get("id") or detail_id, "title": title, "subtitle": subtitle,
                        "label": ", ".join(part for part in (title, subtitle) if part), "type": item.get("type", "place"),
                        "detailsType": detail_type, "detailsId": detail_id, "sessionId": session_id, "source": "TomTom"})
        except (requests.RequestException, ValueError):
            pass

    suggestions = [item for item in suggestions if _matches_detailed_address_context(query, item)]

    if api_key and len(suggestions) < 10:
        try:
            suggestions.extend(_legacy_location_search(query, api_key, limit=15))
        except ProviderError:
            pass
    return _merge_location_results(suggestions)


def resolve_location(selection, api_key, session_id=""):
    if not isinstance(selection, dict):
        raise InputError("Choose a location from the suggestions.")
    try:
        lat, lon = float(selection.get("lat")), float(selection.get("lon"))
        if isfinite(lat) and isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180:
            return {**selection, "lat": lat, "lon": lon}
    except (TypeError, ValueError):
        pass
    if not api_key:
        raise ProviderError("Address search is not configured yet. Add TOMTOM_API_KEY to the backend environment.")
    detail_type, detail_id = selection.get("detailsType"), selection.get("detailsId")
    label = str(selection.get("label") or selection.get("title") or "").strip()
    allowed = {"addresses", "streets", "intersections", "pois", "areas"}
    if detail_type in allowed and detail_id:
        headers = {"TomTom-Api-Key": api_key, "TomTom-Api-Version": "3", "Session-Id": session_id,
                   "Attributes": "id,type,title,subtitles,position,address"}
        try:
            detail = _provider_get(f"https://api.tomtom.com/maps/orbis/places/details/{detail_type}/{requests.utils.quote(str(detail_id), safe='')}", headers=headers)
            position = detail.get("position") or {}
            coordinates = position.get("coordinates") or []
            if len(coordinates) < 2 and position.get("lat") is not None and position.get("lon") is not None:
                coordinates = [position["lon"], position["lat"]]
            if len(coordinates) >= 2:
                title = detail.get("title") or selection.get("title") or label
                subtitles = detail.get("subtitles") or []
                full_label = ", ".join(str(part) for part in [title, *subtitles] if part)
                address = detail.get("address") or {}
                return {"id": detail.get("id") or detail_id, "label": full_label or label,
                        "lat": float(coordinates[1]), "lon": float(coordinates[0]),
                        "type": detail.get("type", selection.get("type", "place")),
                        "country": address.get("country") or ""}
        except (ProviderError, TypeError, ValueError):
            pass
    if not label:
        raise InputError("That suggestion could not be resolved. Search again and choose another result.")
    fallback = _legacy_location_search(label, api_key, limit=1)
    if fallback:
        return fallback[0]
    raise ProviderError("TomTom could not resolve that suggestion. Try another result or a nearby street address.")


def _route_signature(route):
    points = _route_geometry(route)
    if not points:
        return None
    stride = max(1, len(points) // 16)
    shape = tuple((round(point["lat"], 2), round(point["lon"], 2)) for point in points[::stride])
    summary = route.get("summary") or {}
    return shape, round(summary.get("lengthInMeters", 0) / 2000)


def fetch_routes(origin, destination, departure, api_key):
    if not api_key:
        raise ProviderError("Routing is not configured yet. Add TOMTOM_API_KEY to the backend environment.")
    path = f"{origin['lat']},{origin['lon']}:{destination['lat']},{destination['lon']}"
    endpoint = f"{TOMTOM_BASE}/routing/1/calculateRoute/{path}/json"

    def request(route_type, alternatives):
        params = {
            "key": api_key,
            "travelMode": "truck",
            "routeType": route_type,
            "traffic": "true",
            "departAt": departure.isoformat().replace("+00:00", "Z"),
            "maxAlternatives": alternatives,
            "instructionsType": "text",
            "computeTravelTimeFor": "all",
            "coordinatePrecision": "full",
        }
        return _get_json(endpoint, params=params).get("routes") or []

    primary = request("fastest", 2)
    for index, route in enumerate(primary):
        route["_routeSource"] = "router alternative" if index else "fastest"
    routes = []
    signatures = set()
    for index, route in enumerate(primary):
        signature = _route_signature(route)
        if signature and signature not in signatures and len(routes) < 3:
            route["_routeSource"] = "router alternative" if index else "fastest"
            routes.append(route)
            signatures.add(signature)
    # Alternate route preferences produce explicit candidates only when TomTom
    # returns fewer than three alternatives. Keep the truck and time inputs.
    for route_type in ("eco", "short"):
        if len(routes) >= 3:
            break
        try:
            candidates = request(route_type, 0)
        except (InputError, ProviderError):
            continue
        for candidate in candidates:
            signature = _route_signature(candidate)
            if signature and signature not in signatures:
                candidate["_routeSource"] = f"{route_type} candidate"
                routes.append(candidate)
                signatures.add(signature)
                break
    return routes[:3]


def haversine(a, b):
    lat1, lon1 = radians(a["lat"]), radians(a["lon"])
    lat2, lon2 = radians(b["lat"]), radians(b["lon"])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6_371_000 * 2 * asin(sqrt(h))


def _route_geometry(route):
    legs = route.get("legs") or []
    points = []
    for leg in legs:
        for point in leg.get("points") or []:
            candidate = {"lat": point.get("latitude"), "lon": point.get("longitude")}
            if candidate["lat"] is not None and candidate["lon"] is not None:
                if not points or candidate != points[-1]:
                    points.append(candidate)
    return points


def _route_distances(points):
    cumulative = [0.0]
    for left, right in zip(points, points[1:]):
        cumulative.append(cumulative[-1] + haversine(left, right))
    return cumulative


def _point_at(points, cumulative, offset_m):
    if not points:
        return None
    if offset_m <= 0:
        return dict(points[0])
    if offset_m >= cumulative[-1]:
        return dict(points[-1])
    for index in range(1, len(cumulative)):
        if cumulative[index] >= offset_m:
            span = cumulative[index] - cumulative[index - 1]
            ratio = (offset_m - cumulative[index - 1]) / span if span else 0
            return {
                "lat": points[index - 1]["lat"] + (points[index]["lat"] - points[index - 1]["lat"]) * ratio,
                "lon": points[index - 1]["lon"] + (points[index]["lon"] - points[index - 1]["lon"]) * ratio,
            }
    return dict(points[-1])


def _time_at_offset(route, offset_m, total_m, total_seconds):
    instructions = (route.get("guidance") or {}).get("instructions") or []
    timing = []
    for item in instructions:
        dist = item.get("routeOffsetInMeters")
        seconds = item.get("travelTimeInSeconds")
        if isinstance(dist, (int, float)) and isinstance(seconds, (int, float)):
            timing.append((float(dist), float(seconds)))
    timing.sort()
    if not timing:
        return total_seconds * (offset_m / total_m if total_m else 0)
    if timing[0][0] > 0:
        timing.insert(0, (0.0, 0.0))
    if timing[-1][0] < total_m:
        timing.append((total_m, total_seconds))
    for left, right in zip(timing, timing[1:]):
        if left[0] <= offset_m <= right[0]:
            frac = (offset_m - left[0]) / (right[0] - left[0]) if right[0] != left[0] else 0
            return left[1] + (right[1] - left[1]) * frac
    return total_seconds


def sample_route(route, spacing_miles, heat_spacing=HEAT_SPACING_MILES):
    points = _route_geometry(route)
    cumulative = _route_distances(points)
    if len(points) < 2 or not cumulative[-1]:
        raise ProviderError("The routing provider returned a route without usable geometry.")
    total_m = cumulative[-1]
    summary = route.get("summary") or {}
    seconds = float(summary.get("travelTimeInSeconds") or 0)
    if seconds <= 0:
        raise ProviderError("The routing provider did not return a usable travel time.")
    checkpoint_offsets = list(range(0, int(total_m), int(spacing_miles * MILES_TO_METERS)))
    if not checkpoint_offsets or checkpoint_offsets[-1] != int(total_m):
        checkpoint_offsets.append(int(total_m))
    heat_offsets = list(range(0, int(total_m), int(heat_spacing * MILES_TO_METERS)))
    if not heat_offsets or heat_offsets[-1] != int(total_m):
        heat_offsets.append(int(total_m))

    def as_sample(offset):
        return {
            **_point_at(points, cumulative, offset),
            "offsetMeters": offset,
            "offsetMiles": offset * METERS_TO_MILES,
            "travelSeconds": _time_at_offset(route, offset, total_m, seconds),
        }

    return points, total_m, seconds, [as_sample(o) for o in checkpoint_offsets], [as_sample(o) for o in heat_offsets]


def fetch_forecasts(samples, departure, route_duration_seconds):
    """Fetch batched hourly forecast series; all locations share the same UTC timeline."""
    result = []
    forecast_end = departure + timedelta(seconds=route_duration_seconds + 48 * 3600)
    forecast_days = min(16, max(1, ceil((forecast_end - datetime.now(timezone.utc)).total_seconds() / 86400) + 1))
    for start in range(0, len(samples), MAX_COORDS_PER_CALL):
        batch = samples[start : start + MAX_COORDS_PER_CALL]
        latitudes = ",".join(f"{p['lat']:.5f}" for p in batch)
        longitudes = ",".join(f"{p['lon']:.5f}" for p in batch)
        data = _get_json(
            OPEN_METEO,
            params={
                "latitude": latitudes,
                "longitude": longitudes,
                "hourly": "wind_speed_10m,rain,showers,snowfall",
                "wind_speed_unit": "mph",
                "timezone": "UTC",
                "forecast_days": forecast_days,
                "timeformat": "iso8601",
            },
            timeout=40,
        )
        locations = data if isinstance(data, list) else [data]
        if len(locations) != len(batch):
            raise ProviderError("Weather forecast response did not match the requested locations.")
        result.extend(locations)
    return result


def _at_time(weather, arrival):
    hourly = weather.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return None
    target = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    best_index = min(range(len(times)), key=lambda i: abs((parse_datetime(times[i]).replace(tzinfo=timezone.utc) - target).total_seconds()))
    rain_mm_hr = _value(hourly, "rain", best_index)
    showers_mm_hr = _value(hourly, "showers", best_index)
    total_rain_mm_hr = None if rain_mm_hr is None and showers_mm_hr is None else (rain_mm_hr or 0) + (showers_mm_hr or 0)
    return {
        "time": times[best_index],
        "windMph": _value(hourly, "wind_speed_10m", best_index),
        "rainInHr": total_rain_mm_hr / 25.4 if total_rain_mm_hr is not None else None,
        "snowInHr": (_value(hourly, "snowfall", best_index) or 0) / 2.54,
    }


def _value(hourly, name, index):
    values = hourly.get(name) or []
    return values[index] if index < len(values) else None


def _combined_rain_series(hourly):
    rain = hourly.get("rain") or []
    showers = hourly.get("showers") or []
    return [
        None if index >= len(rain) and index >= len(showers)
        else (rain[index] if index < len(rain) and rain[index] is not None else 0)
        + (showers[index] if index < len(showers) and showers[index] is not None else 0)
        for index in range(max(len(rain), len(showers)))
    ]


def classify_weather(weather, load_lbs):
    if weather is None or any(weather.get(key) is None for key in ("windMph", "rainInHr", "snowInHr")):
        return "unavailable"
    wind, rain, snow = weather["windMph"], weather["rainInHr"], weather["snowInHr"]
    ranks = {"low": 0, "moderate": 1, "high": 2, "severe": 3, "no-travel": 4}
    risks = ["low"]
    if wind >= 55:
        risks.append("no-travel")
    elif wind >= 45:
        risks.append("no-travel" if load_lbs > 30000 else "severe")
    elif wind >= 35:
        risks.append("severe" if load_lbs > 40000 else "high")
    elif wind >= 25:
        risks.append("moderate")
    if rain > 1.0:
        risks.append("no-travel")
    elif rain >= 0.5:
        risks.append("severe")
    elif rain >= 0.25:
        risks.append("high")
    elif rain >= 0.10:
        risks.append("moderate")
    if snow > 3.0:
        risks.append("no-travel")
    elif snow >= 2.0:
        risks.append("severe")
    elif snow >= 1.0:
        risks.append("high")
    elif snow >= 0.5:
        risks.append("moderate")
    return max(risks, key=ranks.get)


def _risk_score(risk):
    return {"low": 0, "moderate": 1, "high": 2, "severe": 3, "no-travel": 4, "unavailable": None}.get(risk)


def assess_route(route, route_number, spacing, load_lbs, departure):
    geometry, total_m, duration, checkpoints, heat_samples = sample_route(route, spacing)
    all_samples = checkpoints + heat_samples
    forecast_list = fetch_forecasts(all_samples, departure, duration)
    checkpoint_forecasts = forecast_list[: len(checkpoints)]
    heat_forecasts = forecast_list[len(checkpoints) :]
    scored = []
    for checkpoint, forecast in zip(checkpoints, checkpoint_forecasts):
        arrival = departure + timedelta(seconds=checkpoint["travelSeconds"])
        current = _at_time(forecast, arrival)
        risk = classify_weather(current, load_lbs)
        scored.append({**checkpoint, "eta": arrival.isoformat(), "weather": current, "risk": risk, "riskMiles": 0.0})
    # Midpoint boundaries assign every route mile once; retain precision for scoring.
    for index, checkpoint in enumerate(scored):
        left = 0 if index == 0 else (scored[index - 1]["offsetMiles"] + checkpoint["offsetMiles"]) / 2
        right = total_m * METERS_TO_MILES if index == len(scored) - 1 else (checkpoint["offsetMiles"] + scored[index + 1]["offsetMiles"]) / 2
        checkpoint["riskMiles"] = max(0, right - left)

    hourly = []
    for sample, forecast in zip(heat_samples, heat_forecasts):
        series = forecast.get("hourly") or {}
        hourly.append({
            **sample,
            "time": series.get("time", []),
            "windMph": series.get("wind_speed_10m", []),
            "rainMmHr": _combined_rain_series(series),
            "snowCmHr": series.get("snowfall", []),
        })
    severe = sum(point["riskMiles"] for point in scored if point["risk"] == "severe")
    high = sum(point["riskMiles"] for point in scored if point["risk"] == "high")
    no_travel = sum(point["riskMiles"] for point in scored if point["risk"] == "no-travel")
    scored_miles = sum(point["riskMiles"] for point in scored if _risk_score(point["risk"]) is not None)
    average_risk = (
        sum(_risk_score(point["risk"]) * point["riskMiles"] for point in scored if _risk_score(point["risk"]) is not None) / scored_miles
        if scored_miles else None
    )
    summary = route.get("summary") or {}
    return {
        "id": f"route-{route_number}",
        "label": {"fastest": "Fastest route", "router alternative": "Alternative route", "eco candidate": "Eco candidate", "short candidate": "Balanced candidate"}.get(route.get("_routeSource"), f"Route {route_number}"),
        "source": route.get("_routeSource", "router alternative"),
        "distanceMiles": round(total_m * METERS_TO_MILES, 1),
        "durationSeconds": duration,
        "eta": (departure + timedelta(seconds=duration)).isoformat(),
        "trafficDelaySeconds": summary.get("trafficDelayInSeconds", 0),
        "geometry": [{"lat": p["latitude"], "lon": p["longitude"]} for leg in (route.get("legs") or []) for p in (leg.get("points") or [])],
        "checkpoints": scored,
        "heatSamples": hourly,
        "summary": {
            "severeMiles": round(severe, 1),
            "highMiles": round(high, 1),
            "noTravelMiles": round(no_travel, 1),
            "averageRisk": round(average_risk, 2) if average_risk is not None else None,
            "forecastCoverageComplete": all(point["risk"] != "unavailable" for point in scored),
        },
    }


def build_trip_plan(payload, api_key):
    origin, destination, departure, load_lbs, spacing = validate_payload(payload)
    routes = fetch_routes(origin, destination, departure, api_key)
    if not routes:
        raise InputError("TomTom could not find a truck-legal route between these locations. Check the addresses or choose a nearby road entrance.")
    route_points = [_route_geometry(route) for route in routes]
    route_points = [points for points in route_points if points]
    if not route_points:
        raise InputError("TomTom returned no usable truck route for these locations. Choose different addresses and try again.")
    closest_origin_snap = min(haversine(origin, points[0]) for points in route_points)
    closest_destination_snap = min(haversine(destination, points[-1]) for points in route_points)
    if closest_origin_snap > 4828:
        raise InputError("The selected origin is more than 3 miles from a truck-accessible road. Choose a nearby street address or yard entrance.")
    if closest_destination_snap > 4828:
        raise InputError("The selected destination is more than 3 miles from a truck-accessible road. Choose a nearby street address or dock entrance.")
    planned = [assess_route(route, index + 1, spacing, load_lbs, departure) for index, route in enumerate(routes)]
    usable = [route for route in planned if route["summary"]["forecastCoverageComplete"]]
    winner = min(
        usable,
        key=lambda route: (
            route["summary"]["noTravelMiles"] > 0,
            route["summary"]["severeMiles"],
            route["summary"]["highMiles"],
            route["summary"]["averageRisk"] if route["summary"]["averageRisk"] is not None else float("inf"),
            route["durationSeconds"],
        ),
        default=None,
    )
    # Mark routes with any no-travel mileage as infeasible, so feasible routes always win.
    if winner and winner["summary"]["noTravelMiles"] > 0:
        winner = None
    return {
        "origin": origin,
        "destination": destination,
        "departure": departure.isoformat(),
        "loadWeightLbs": load_lbs,
        "spacingMiles": spacing,
        "routes": planned,
        "recommendedRouteId": winner["id"] if winner else None,
        "routeCount": len(planned),
        "routeNotice": (
            "TomTom returned fewer than three alternatives; additional route preferences are shown as candidates."
            if any(route.get("source", "").endswith("candidate") for route in planned)
            else "The routing provider returned fewer than three distinct route options." if len(planned) < 3 else None
        ),
        "recommendationNotice": "No route is fully forecast-covered and free of No Travel risk." if winner is None else None,
    }
