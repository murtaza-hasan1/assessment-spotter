# StormHaul

Weather-aware route planning for truck trips. The repository is split into a React frontend and a Django API so they can be deployed independently to Vercel and Render.

## Architecture

```text
frontend/  React + Vite + Leaflet UI with Mapbox basemap (Vercel)
backend/   Django REST API; Mapbox geocoding, TomTom routing + Open-Meteo forecasts (Render)
```

## Local setup

### Backend

Install Python 3.11+ and run from `backend/`:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
py manage.py runserver
```

Set `TOMTOM_API_KEY` and `MAPBOX_ACCESS_TOKEN` in `backend/.env`. TomTom is used for truck routing and fallback place search; Mapbox Geocoding v6 powers global address autocomplete and full-address search. Use temporary Mapbox results only during the active trip session; they must not be stored for later use and must be shown with a Mapbox map. The map uses Mapbox Streets tiles when `VITE_MAPBOX_ACCESS_TOKEN` is set. The Open-Meteo free API does not need a key and is for non-commercial use.

### Address selection

Origin and destination accept street addresses, warehouse or yard names, docks, cities, and postal codes without a country restriction. Suggestions use Mapbox Geocoding v6, with TomTom Places and Fuzzy Search as additional candidates. For a detailed query, results missing explicitly requested location, phase, sector, or block details are filtered out. Select a resolved result before planning. Use **Choose on map** beside either field to open a Mapbox map, drop or drag a pin, reverse-geocode the nearest available street/place label, and use the pin's exact coordinates for routing. Pakistan and other regions can have less address-level coverage than Google Maps; when providers don't index a house number, include the road, neighborhood, city, and country. Search requests are debounced by 300 ms. The first origin suggestion is **Use my current location**. It requests browser permission, reverse-geocodes the captured coordinates into a readable place label, and retains the exact GPS coordinates for routing. When that origin is selected, the app follows the device while the page is open, updates remaining distance and ETA, and recalculates the route and weather if the device stays more than 1.5 miles from the planned route for 20 seconds. Checkpoint weather is refreshed whenever the route is recalculated. The live view is not turn-by-turn navigation and does not run in the background. Browser location requires permission and HTTPS (localhost is supported). The map distinguishes the selected place from the start and end points TomTom snaps to the truck route. Identical places, locations more than three miles from a truck-accessible road, and trips with no truck-legal route show a clear error.

### Frontend

Install Node.js 20+ and run from `frontend/`:

```powershell
npm install
npm run dev
```

The Vite dev server proxies `/api` to Django at `http://127.0.0.1:8000`.

## Deployment

- **Vercel:** set the project root to `frontend/`, framework to Vite, `VITE_API_BASE_URL` to the public Render API URL (no trailing slash), and `VITE_MAPBOX_ACCESS_TOKEN` to a public Mapbox token. The free Hobby plan is limited to personal and non-commercial use.
- **Render:** create a Python web service with root `backend/`, build command `pip install -r requirements.txt && python manage.py migrate`, start command `gunicorn config.wsgi:application`. Configure `TOMTOM_API_KEY`, `MAPBOX_ACCESS_TOKEN`, `FRONTEND_ORIGIN`, and `DJANGO_SECRET_KEY`. The free Render service sleeps when idle, so its first request may take about a minute.
- The app intentionally has no trip database yet; trip calculations are stateless.

## Risk and forecast behavior

- Liquid precipitation combines Open-Meteo's separate rain and convective-showers hourly fields, then converts mm/hour to inches/hour; snowfall from cm/hour is converted to inches/hour; wind is requested in mph.
- Sustained wind speed drives the supplied thresholds.
- The higher risk among wind, rain, and snow determines checkpoint risk. Wind load rules raise the resulting checkpoint risk as specified.
- Range boundaries are lower-inclusive and upper-exclusive except where the written rules use `>`; for example, 35 mph begins the High wind band and 55 mph begins No Travel.
- A route containing any No Travel checkpoint is considered infeasible before applying the requested severe/high/average/time ranking.
- Mile attribution uses Voronoi-style half-gaps between checkpoints, so each route mile is attributed once. Endpoints are sampled and represented.
- Route risk checkpoints follow the selected spacing. Heatmap samples use independent fixed spacing; their hourly forecasts are fetched once and scrubbed in the browser.
- The forecast slider is relative to the selected departure. Planned-route risk still uses the estimated arrival time at each checkpoint.
- If the selected date or a checkpoint is outside forecast coverage, the UI marks it unavailable rather than treating it as safe.

## Provider and map notes

TomTom's route API may return fewer alternatives than requested. If so, the backend tries eco and balanced route preferences; distinct results are labeled as candidates, and identical paths are removed. The response displays the number actually available; it does not invent alternatives. Map tiles use Mapbox Streets with visible Mapbox and OpenStreetMap attribution. Provider and free-tier terms can change; this setup is intended for a non-commercial assessment demo. Mapbox Geocoding's free temporary tier currently includes 100,000 requests/month; autocomplete requests are counted per request, so the 300 ms debounce and minimum input length reduce usage.

For the Loom walkthrough, demonstrate both a street-level warehouse or dock address and a city-only address to show the two supported input styles. You can also demonstrate live trip mode by selecting the current-location origin and granting browser permission.
