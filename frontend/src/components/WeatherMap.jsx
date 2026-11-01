import { Fragment, useEffect, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet.heat'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { getLiveRouteMetrics } from '../lib/live.js'
import { formatRiskBreakdown } from '../lib/format.js'

const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

const routeColors = ['#226192', '#EF8557', '#3d7a64']
const riskColors = { low: '#2e8f6b', moderate: '#d4a23f', high: '#e7863b', severe: '#d5554c', 'no-travel': '#833e5c', unavailable: '#9ca3a1' }
const WORLD_BOUNDS = [[-85, -180], [85, 180]]

function fitGeometry(map, routes) {
  const coordinates = routes.flatMap((route) => route.geometry || []).map((point) => [point.lat, point.lon])
  if (coordinates.length) {
    map.fitBounds(L.latLngBounds(coordinates), { padding: [35, 35], maxZoom: 13 })
  }
}

function FitRoutes({ route }) {
  const map = useMap()
  useEffect(() => {
    if (route) fitGeometry(map, [route])
  }, [map, route?.id])
  return null
}

function FitInitial({ origin, destination }) {
  const map = useMap()
  useEffect(() => {
    const pts = []
    if (origin?.lat && origin?.lon) pts.push([origin.lat, origin.lon])
    if (destination?.lat && destination?.lon) pts.push([destination.lat, destination.lon])
    if (pts.length === 1) {
      map.setView(pts[0], 11, { animate: true })
    } else if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 12 })
    }
  }, [map, origin?.lat, origin?.lon, destination?.lat, destination?.lon])
  return null
}

function AutoResizeMap({ isInitial }) {
  const map = useMap()
  useEffect(() => {
    map.setMaxBounds(WORLD_BOUNDS)
    map.options.maxBoundsViscosity = 1.0
    map.setMinZoom(3)
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 200)
    return () => clearTimeout(timer)
  }, [map, isInitial])
  return null
}

function routeMapPositions(route) {
  return (route.geometry || []).map((point) => [point.lat, point.lon])
}

function FollowLiveLocation({ location }) {
  const map = useMap()
  useEffect(() => {
    if (location) map.panTo([location.lat, location.lon], { animate: true, duration: 0.6 })
  }, [map, location?.lat, location?.lon])
  return null
}

function HeatLayer({ samples, hourIndex, loadWeightLbs }) {
  const map = useMap()
  const points = useMemo(() => samples.map((sample) => {
    const risk = sampleRisk(sample, hourIndex, loadWeightLbs)
    const intensity = { low: 0.28, moderate: 0.46, high: 0.65, severe: 0.83, 'no-travel': 1, unavailable: 0.16 }[risk]
    return [sample.lat, sample.lon, intensity]
  }), [samples, hourIndex, loadWeightLbs])

  useEffect(() => {
    if (!points.length || !L.heatLayer) return undefined
    if (!map.getPane('heatLayer')) {
      map.createPane('heatLayer')
      map.getPane('heatLayer').style.zIndex = 350
    }
    const layer = L.heatLayer(points, { pane: 'heatLayer', radius: 36, blur: 24, maxZoom: 9, minOpacity: 0.42, gradient: { 0: '#398d68', 0.25: '#4ba275', 0.45: '#d4a23f', 0.65: '#e7863b', 0.83: '#d5554c', 1: '#833e5c' } }).addTo(map)
    return () => map.removeLayer(layer)
  }, [map, points])
  return null
}

function sampleRisk(sample, hourIndex, loadWeightLbs) {
  const wind = sample.windMph?.[hourIndex]
  const rainMmHr = sample.rainMmHr?.[hourIndex]
  const snowCmHr = sample.snowCmHr?.[hourIndex]
  if (wind == null || rainMmHr == null || snowCmHr == null) return 'unavailable'
  return classify(wind, rainMmHr / 25.4, snowCmHr / 2.54, loadWeightLbs)
}

function classify(wind, rain, snow, load) {
  let levels = ['low']
  if (wind >= 55) levels.push('no-travel')
  else if (wind >= 45) levels.push(load > 30000 ? 'no-travel' : 'severe')
  else if (wind >= 35) levels.push(load > 40000 ? 'severe' : 'high')
  else if (wind >= 25) levels.push('moderate')
  if (rain > 1) levels.push('no-travel'); else if (rain >= 0.5) levels.push('severe'); else if (rain >= 0.25) levels.push('high'); else if (rain >= 0.1) levels.push('moderate')
  if (snow > 3) levels.push('no-travel'); else if (snow >= 2) levels.push('severe'); else if (snow >= 1) levels.push('high'); else if (snow >= 0.5) levels.push('moderate')
  return levels.sort((a, b) => ['low', 'moderate', 'high', 'severe', 'no-travel'].indexOf(b) - ['low', 'moderate', 'high', 'severe', 'no-travel'].indexOf(a))[0]
}

export default function WeatherMap({ routes = [], origin, destination, liveLocation, selectedRouteId, onSelectRoute, sliderHour = 0, loadWeightLbs = 28000, isInitial = false }) {
  const hasRoutes = routes.length > 0
  const selected = hasRoutes ? (routes.find((route) => route.id === selectedRouteId) || routes[0]) : null
  const liveMetrics = liveLocation && selected ? getLiveRouteMetrics(selected, liveLocation) : null
  const samples = selected?.heatSamples || []
  const forecastTimes = samples[0]?.time || []
  const departureMs = selected?.checkpoints?.[0]?.eta ? new Date(selected.checkpoints[0].eta).getTime() : Date.now()
  const targetMs = departureMs + sliderHour * 3600000
  const hourIndex = forecastTimes.length ? forecastTimes.reduce((best, time, index) => Math.abs(new Date(time).getTime() - targetMs) < Math.abs(new Date(forecastTimes[best]).getTime() - targetMs) ? index : best, 0) : 0
  const forecastAvailable = forecastTimes.length > 0 && targetMs >= new Date(forecastTimes[0]).getTime() && targetMs <= new Date(forecastTimes[forecastTimes.length - 1]).getTime()

  return (
    <div className={`map-wrap ${isInitial ? 'map-wrap-initial' : 'map-wrap-active'}`}>
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        minZoom={3}
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={1.0}
        scrollWheelZoom
        className="map-canvas"
      >
        {mapboxToken
          ? <TileLayer noWrap bounds={WORLD_BOUNDS} attribution="&copy; <a href='https://www.mapbox.com/about/maps/'>Mapbox</a> &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${mapboxToken}`} />
          : <TileLayer noWrap bounds={WORLD_BOUNDS} attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />}
        <AutoResizeMap isInitial={isInitial} />

        {/* Initial state view: fit placed origin/destination pins if available */}
        {!hasRoutes && <FitInitial origin={origin} destination={destination} />}

        {/* Route polylines follow actual road geometry without straight displacement segments */}
        {hasRoutes && routes.map((route, index) => {
          const routeColor = routeColors[index % routeColors.length]
          const isSelected = route.id === selected?.id
          return (
            <Polyline
              key={route.id}
              positions={routeMapPositions(route)}
              pathOptions={{
                color: routeColor,
                weight: isSelected ? 6 : 3.5,
                opacity: isSelected ? 1 : 0.55
              }}
              eventHandlers={{ click: () => onSelectRoute?.(route.id) }}
              bubblingMouseEvents={false}
            >
              <Tooltip sticky>{route.label} · click to select</Tooltip>
            </Polyline>
          )
        })}

        {/* Selected route active state & overlays */}
        {selected && (
          <>
            <FitRoutes route={selected} />
            {liveLocation && <FollowLiveLocation location={liveLocation} />}
            {liveMetrics?.closestIndex > 0 && (
              <Polyline
                positions={selected.geometry.slice(0, liveMetrics.closestIndex + 1).map((point) => [point.lat, point.lon])}
                pathOptions={{ color: '#7f8d83', weight: 7, opacity: 0.8, dashArray: '5 7' }}
                interactive={false}
              />
            )}
            {forecastAvailable && <HeatLayer samples={samples} hourIndex={hourIndex} loadWeightLbs={loadWeightLbs} />}
          </>
        )}

        {/* Checkpoint nodes for the active selected route (matches table details exactly) */}
        {selected && selected.checkpoints && selected.checkpoints.map((point, index) => {
          return (
            <CircleMarker
              key={`selected-checkpoint-${selected.id}-${point.offsetMiles}-${index}`}
              center={[point.lat, point.lon]}
              radius={6}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: riskColors[point.risk] || '#9ca3a1',
                fillOpacity: 1,
              }}
            >
              <Popup>
                <div style={{ minWidth: '170px', fontSize: '12px', lineHeight: '1.45' }}>
                  <strong style={{ fontSize: '13px', color: '#1c2128' }}>
                    {point.offsetMiles < 1 ? 'Trip Origin' : `Mile ${point.offsetMiles.toFixed(0)}`}
                  </strong>
                  <br />
                  <span style={{ color: '#57606a' }}>
                    ETA: {point.eta ? new Date(point.eta).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </span>
                  <hr style={{ margin: '6px 0', border: 0, borderTop: '1px solid #e1e4e8' }} />
                  <div>
                    <strong>Risk: </strong>
                    <span style={{ color: riskColors[point.risk], fontWeight: 700 }}>
                      {point.risk.toUpperCase()}
                    </span>
                    <span style={{ color: '#57606a' }}> ({point.riskMiles.toFixed(1)} mi)</span>
                  </div>
                  <div>Wind: <strong>{point.weather?.windMph != null ? `${Math.round(point.weather.windMph)} mph` : '—'}</strong></div>
                  <div>Rain: <strong>{point.weather?.rainInHr != null ? `${point.weather.rainInHr.toFixed(2)} in/hr` : '—'}</strong></div>
                  <div>Snow: <strong>{point.weather?.snowInHr != null ? `${point.weather.snowInHr.toFixed(2)} in/hr` : '—'}</strong></div>
                  <div style={{ marginTop: '5px', paddingTop: '5px', borderTop: '1px dashed #e1e4e8', fontSize: '11px', color: '#4b5563' }}>
                    <strong>Breakdown: </strong>{point.breakdown || formatRiskBreakdown(point, loadWeightLbs)}
                  </div>
                </div>
              </Popup>
              <Tooltip direction="top">
                <strong>{point.offsetMiles < 1 ? 'Origin' : `${point.offsetMiles.toFixed(0)} mi`} · {point.risk.toUpperCase()}</strong><br />
                ETA: {point.eta ? new Date(point.eta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}<br />
                Wind: {point.weather?.windMph != null ? `${Math.round(point.weather.windMph)} mph` : '—'} · Rain: {point.weather?.rainInHr != null ? `${point.weather.rainInHr.toFixed(2)} in` : '—'}
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* Origin and Destination markers */}
        {origin && origin.lat != null && origin.lon != null && (
          <CircleMarker center={[origin.lat, origin.lon]} radius={8} pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#226192', fillOpacity: 1 }}>
            <Popup>
              <strong>Origin:</strong> {origin.label}
              {origin.isCurrentLocation && origin.accuracyMeters != null && (
                <><br /><small>Device accuracy: ~{origin.accuracyMeters} m</small></>
              )}
            </Popup>
          </CircleMarker>
        )}
        {destination && destination.lat != null && destination.lon != null && (
          <CircleMarker center={[destination.lat, destination.lon]} radius={8} pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#EF8557', fillOpacity: 1 }}>
            <Popup>
              <strong>Destination:</strong> {destination.label}
            </Popup>
          </CircleMarker>
        )}

        {/* Live location driver marker */}
        {liveLocation && liveLocation.lat != null && liveLocation.lon != null && (
          <CircleMarker center={[liveLocation.lat, liveLocation.lon]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillColor: '#287bd1', fillOpacity: 1 }}>
            <Tooltip permanent direction="top" offset={[0, -8]}>
              You are here{liveMetrics ? ` · ${liveMetrics.remainingMiles.toFixed(1)} mi remaining` : ''}
            </Tooltip>
            <Popup>Live device position<br />Accuracy: ~{liveLocation.accuracyMeters ?? 'unknown'} m</Popup>
          </CircleMarker>
        )}
      </MapContainer>

      {/* Floating map banner on initial load */}
      {isInitial && (
        <div className="map-initial-banner">
          <span className="live-dot" />
          <span>Interactive Highway Map · Enter origin & destination or tap <strong>Choose on map</strong> to plan your corridor</span>
        </div>
      )}

      {/* Weather risk scale legend */}
      {hasRoutes && (
        <div className="map-key">
          <strong>Weather risk</strong>
          <span><i className="key-dot risk-low" />Low</span>
          <span><i className="key-dot risk-moderate" />Moderate</span>
          <span><i className="key-dot risk-high" />High</span>
          <span><i className="key-dot risk-severe" />Severe</span>
          <span><i className="key-dot risk-no-travel" />No travel</span>
        </div>
      )}

      {hasRoutes && !forecastAvailable && (
        <div className="forecast-unavailable">Forecast not available at this time</div>
      )}

      {/* Route quick-pick switcher floating on map */}
      {routes.length > 1 && (
        <div className="map-route-picks">
          {routes.map((route, index) => (
            <button
              key={route.id}
              type="button"
              className={route.id === selected?.id ? 'route-pick active' : 'route-pick'}
              onClick={() => onSelectRoute?.(route.id)}
            >
              <i style={{ background: routeColors[index % routeColors.length] }} />
              {route.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
