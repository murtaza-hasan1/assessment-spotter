import { Fragment, useEffect, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet.heat'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { getLiveRouteMetrics, milesBetween } from '../lib/live.js'

const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

const routeColors = ['#245b4b', '#d0833f', '#65799b']
const riskColors = { low: '#2e8f6b', moderate: '#d4a23f', high: '#e7863b', severe: '#d5554c', 'no-travel': '#833e5c', unavailable: '#9ca3a1' }

function fitGeometry(map, routes, origin) {
  const coordinates = routes.flatMap((route) => route.geometry || []).map((point) => [point.lat, point.lon])
  if (origin?.isCurrentLocation) coordinates.push([origin.lat, origin.lon])
  if (coordinates.length) map.fitBounds(L.latLngBounds(coordinates), { padding: [35, 35], maxZoom: 7 })
}

function FitRoutes({ route, origin }) {
  const map = useMap()
  useEffect(() => { fitGeometry(map, [route], origin) }, [map, route?.id, origin?.lat, origin?.lon])
  return null
}

function routeMapPositions(route, origin) {
  const points = (route.geometry || []).map((point) => [point.lat, point.lon])
  if (origin?.isCurrentLocation && points.length && milesBetween(origin, { lat: points[0][0], lon: points[0][1] }) > 0.001) {
    points.unshift([origin.lat, origin.lon])
  }
  return points
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

export default function WeatherMap({ routes, origin, destination, liveLocation, selectedRouteId, onSelectRoute, sliderHour, loadWeightLbs }) {
  const selected = routes.find((route) => route.id === selectedRouteId) || routes[0]
  const liveMetrics = liveLocation ? getLiveRouteMetrics(selected, liveLocation) : null
  const samples = selected?.heatSamples || []
  const forecastTimes = samples[0]?.time || []
  const departureMs = selected?.checkpoints?.[0]?.eta ? new Date(selected.checkpoints[0].eta).getTime() : Date.now()
  const targetMs = departureMs + sliderHour * 3600000
  const hourIndex = forecastTimes.length ? forecastTimes.reduce((best, time, index) => Math.abs(new Date(time).getTime() - targetMs) < Math.abs(new Date(forecastTimes[best]).getTime() - targetMs) ? index : best, 0) : 0
  const forecastAvailable = forecastTimes.length > 0 && targetMs >= new Date(forecastTimes[0]).getTime() && targetMs <= new Date(forecastTimes[forecastTimes.length - 1]).getTime()

  return (
    <div className="map-wrap">
      <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom className="map-canvas">
        {mapboxToken
          ? <TileLayer attribution="&copy; <a href='https://www.mapbox.com/about/maps/'>Mapbox</a> &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${mapboxToken}`} />
          : <TileLayer attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />}
        {routes.map((route, index) => {
          const routeColor = routeColors[index % routeColors.length]
          const snappedStart = route.geometry?.[0]
          const needsConnector = origin?.isCurrentLocation && snappedStart && milesBetween(origin, snappedStart) > 0.001
          return <Fragment key={route.id}>
            <Polyline key={route.id} positions={routeMapPositions(route, origin)} pathOptions={{ color: routeColor, weight: route.id === selected?.id ? 6 : 3, opacity: route.id === selected?.id ? 1 : 0.52 }} eventHandlers={{ click: () => onSelectRoute(route.id) }} bubblingMouseEvents={false}><Tooltip sticky>{route.label} · click to select</Tooltip></Polyline>
            {needsConnector && <Polyline key={`${route.id}-gps-connector`} positions={[[origin.lat, origin.lon], [snappedStart.lat, snappedStart.lon]]} pathOptions={{ color: routeColor, weight: 3, opacity: 0.9, dashArray: '4 7' }} interactive={false}><Tooltip>Exact device origin to TomTom’s truck-road snap point</Tooltip></Polyline>}
          </Fragment>
        })}
        {selected && <>
          <FitRoutes route={selected} origin={origin} />
          {liveLocation && <FollowLiveLocation location={liveLocation} />}
          {liveMetrics?.closestIndex > 0 && <Polyline positions={selected.geometry.slice(0, liveMetrics.closestIndex + 1).map((point) => [point.lat, point.lon])} pathOptions={{ color: '#7f8d83', weight: 7, opacity: 0.8, dashArray: '5 7' }} interactive={false} />}
          {forecastAvailable && <HeatLayer samples={samples} hourIndex={hourIndex} loadWeightLbs={loadWeightLbs} />}
          {forecastAvailable && samples.map((sample, index) => {
            const risk = sampleRisk(sample, hourIndex, loadWeightLbs)
            const wind = sample.windMph?.[hourIndex]
            const rain = sample.rainMmHr?.[hourIndex]
            const snow = sample.snowCmHr?.[hourIndex]
            return <CircleMarker key={`weather-${selected.id}-${index}`} center={[sample.lat, sample.lon]} radius={4.5} pathOptions={{ color: '#fff', weight: 1.5, fillColor: riskColors[risk], fillOpacity: 1 }}>
              <Tooltip direction="top"><strong>{selected.label} · weather sample</strong><br />{risk.replace('-', ' ')} risk<br />Wind: {wind == null ? '—' : `${Math.round(wind)} mph`} · Rain: {rain == null ? '—' : `${(rain / 25.4).toFixed(2)} in/hr`} · Snow: {snow == null ? '—' : `${(snow / 2.54).toFixed(2)} in/hr`}</Tooltip>
            </CircleMarker>
          })}
        </>}
        {routes.flatMap((route) => route.checkpoints.map((point, index) => {
          const active = route.id === selected?.id
          return <CircleMarker key={`${route.id}-${index}`} center={[point.lat, point.lon]} radius={active ? 6 : 3.5} pathOptions={{ color: '#fff', weight: active ? 2 : 1.2, fillColor: riskColors[point.risk], fillOpacity: active ? 1 : 0.78 }} eventHandlers={{ click: () => onSelectRoute(route.id) }}>
            <Tooltip direction="top"><strong>{route.label} · {point.offsetMiles.toFixed(0)} mi · {point.eta ? new Date(point.eta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</strong><br />{point.risk.replace('-', ' ')} risk{point.weather?.windMph != null ? ` · ${Math.round(point.weather.windMph)} mph wind` : ''}</Tooltip>
          </CircleMarker>
        }))}
        {origin && <CircleMarker center={[origin.lat, origin.lon]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#577aa8', fillOpacity: 1 }}><Popup>{origin.isCurrentLocation ? 'Your location when the trip was planned: ' : 'Selected origin: '}{origin.label}{origin.isCurrentLocation && origin.accuracyMeters != null && <><br />Device-reported accuracy: about {origin.accuracyMeters} m</>}</Popup></CircleMarker>}
        {destination && <CircleMarker center={[destination.lat, destination.lon]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#577aa8', fillOpacity: 1 }}><Popup>Selected destination: {destination.label}</Popup></CircleMarker>}
        {selected?.geometry?.length > 0 && <>
          <CircleMarker center={[selected.geometry[0].lat, selected.geometry[0].lon]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: '#245b4b', fillOpacity: 1 }}><Popup>Truck route start — snapped to the road</Popup></CircleMarker>
          <CircleMarker center={[selected.geometry.at(-1).lat, selected.geometry.at(-1).lon]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: '#d18744', fillOpacity: 1 }}><Popup>Truck route end — snapped to the road</Popup></CircleMarker>
        </>}
        {liveLocation && <CircleMarker center={[liveLocation.lat, liveLocation.lon]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillColor: '#287bd1', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -8]}>You are here{liveMetrics ? ` · ${liveMetrics.remainingMiles.toFixed(1)} mi remaining` : ''}</Tooltip>
          <Popup>Live device location<br />Accuracy: about {liveLocation.accuracyMeters ?? 'unknown'} m</Popup>
        </CircleMarker>}
      </MapContainer>
      <div className="map-key"><strong>Weather risk</strong><span><i className="key-dot risk-low" />Low</span><span><i className="key-dot risk-moderate" />Moderate</span><span><i className="key-dot risk-high" />High</span><span><i className="key-dot risk-severe" />Severe</span><span><i className="key-dot risk-no-travel" />No travel</span></div>
      {!forecastAvailable && <div className="forecast-unavailable">Forecast not available at this time</div>}
      {routes.length > 1 && <div className="map-route-picks">{routes.map((route, index) => <button key={route.id} className={route.id === selected?.id ? 'route-pick active' : 'route-pick'} onClick={() => onSelectRoute(route.id)}><i style={{ background: routeColors[index % routeColors.length] }} />{route.label}</button>)}</div>}
    </div>
  )
}
