import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeftRight, ArrowRight, CalendarDays, Check, Clock3, CloudDrizzle, CloudSun, Compass, Gauge, MapPin, Navigation, ShieldCheck, SlidersHorizontal, Truck, Wind } from 'lucide-react'
import WeatherMap from './components/WeatherMap.jsx'
import AddressAutocomplete from './components/AddressAutocomplete.jsx'
import MapLocationPicker from './components/MapLocationPicker.jsx'
import { getHealth, planTrip, reverseGeocodeLocation } from './lib/api.js'
import { formatClock, formatDate, formatDuration, localDateTimeValue, riskLabel } from './lib/format.js'
import { getLiveRouteMetrics, milesBetween } from './lib/live.js'

const initialDeparture = () => localDateTimeValue(new Date(Date.now() + 2 * 3600000))

function App() {
  const [form, setForm] = useState({ originQuery: '', destinationQuery: '', origin: null, destination: null, departure: initialDeparture(), loadWeight: '28000', spacingMiles: 25 })
  const [plan, setPlan] = useState(null)
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [sliderHour, setSliderHour] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [locationError, setLocationError] = useState('')
  const [locatingOrigin, setLocatingOrigin] = useState(false)
  const [mapPicker, setMapPicker] = useState(null)
  const [livePosition, setLivePosition] = useState(null)
  const [liveError, setLiveError] = useState('')
  const [isRerouting, setIsRerouting] = useState(false)
  const speedAnchor = useRef(null)
  const offRouteSince = useRef(null)
  const rerouteInFlight = useRef(false)
  const lastRerouteAt = useRef(0)
  const [apiStatus, setApiStatus] = useState('checking')
  const selectedRoute = plan?.routes.find((route) => route.id === selectedRouteId) || plan?.routes[0]

  useEffect(() => { getHealth().then((health) => setApiStatus(health.routing_configured ? 'ready' : 'missing-key')).catch(() => setApiStatus('offline')) }, [])

  useEffect(() => {
    if (!plan?.origin?.isCurrentLocation) {
      setLivePosition(null)
      setLiveError('')
      speedAnchor.current = null
      return undefined
    }
    if (!navigator.geolocation) {
      setLiveError('This browser cannot provide live location updates. The planned route is still available.')
      return undefined
    }

    const initial = { lat: plan.origin.lat, lon: plan.origin.lon, accuracyMeters: plan.origin.accuracyMeters, updatedAt: Date.now(), speedMph: null }
    setLivePosition((current) => current || initial)
    speedAnchor.current = { ...initial }
    setLiveError('')
    let watchId
    try {
      watchId = navigator.geolocation.watchPosition((position) => {
        const now = Date.now()
        const next = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lon: Number(position.coords.longitude.toFixed(6)),
          accuracyMeters: Math.round(position.coords.accuracy),
          updatedAt: now,
        }
        let measuredSpeed = null
        const anchor = speedAnchor.current
        if (anchor && now - anchor.updatedAt >= 20000 && anchor.accuracyMeters <= 500 && next.accuracyMeters <= 500) {
          const hours = (now - anchor.updatedAt) / 3600000
          measuredSpeed = milesBetween(anchor, next) / hours
          speedAnchor.current = next
        } else if (!anchor || anchor.accuracyMeters > 500) {
          speedAnchor.current = next
        }
        if (position.coords.speed != null && Number.isFinite(position.coords.speed)) measuredSpeed = position.coords.speed * 2.236936
        setLivePosition((previous) => {
          const candidate = measuredSpeed != null && measuredSpeed >= 0 && measuredSpeed <= 100 ? measuredSpeed : previous?.speedMph
          const speedMph = candidate == null ? null : previous?.speedMph == null ? candidate : previous.speedMph * 0.65 + candidate * 0.35
          return { ...next, speedMph }
        })
        setLiveError('')
      }, (geoError) => {
        setLiveError(geoError.code === geoError.PERMISSION_DENIED
          ? 'Live location updates are blocked. Allow location for this site in browser settings; the planned route remains visible.'
          : 'Live location updates are unavailable. The planned route remains visible.')
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 })
    } catch {
      setLiveError('Live location updates could not start. The planned route remains visible.')
    }
    return () => { if (watchId != null) navigator.geolocation.clearWatch(watchId) }
  }, [plan?.origin?.isCurrentLocation])

  useEffect(() => {
    if (!plan?.origin?.isCurrentLocation || !livePosition || !selectedRoute || rerouteInFlight.current || livePosition.accuracyMeters > 500) {
      offRouteSince.current = null
      return undefined
    }
    if (milesBetween(plan.origin, livePosition) < 0.75) {
      offRouteSince.current = null
      return undefined
    }
    const metrics = getLiveRouteMetrics(selectedRoute, livePosition)
    if (!metrics || metrics.distanceFromRouteMiles < 1.5) {
      offRouteSince.current = null
      return undefined
    }
    const now = Date.now()
    if (offRouteSince.current == null) offRouteSince.current = now
    if (now - offRouteSince.current < 20000 || now - lastRerouteAt.current < 120000) return undefined

    rerouteInFlight.current = true
    lastRerouteAt.current = now
    setIsRerouting(true)
    setLiveError('')
    const origin = {
      lat: livePosition.lat,
      lon: livePosition.lon,
      label: `My current location (${livePosition.lat.toFixed(4)}, ${livePosition.lon.toFixed(4)})`,
      isCurrentLocation: true,
      accuracyMeters: livePosition.accuracyMeters,
    }
    planTrip({
      origin,
      destination: plan.destination,
      departure: new Date(now + 5 * 60000).toISOString(),
      loadWeight: plan.loadWeightLbs,
      spacingMiles: plan.spacingMiles,
    }).then((result) => {
      setPlan(result)
      setSelectedRouteId(result.recommendedRouteId || result.routes[0]?.id || null)
      setSliderHour(0)
      offRouteSince.current = null
    }).catch((requestError) => {
      setLiveError(`Automatic reroute failed: ${requestError.message}`)
      offRouteSince.current = null
    }).finally(() => {
      rerouteInFlight.current = false
      setIsRerouting(false)
    })
    return undefined
  }, [livePosition, plan, selectedRoute])

  const sliderLabel = useMemo(() => {
    const start = plan?.departure ? new Date(plan.departure) : new Date(form.departure)
    start.setHours(start.getHours() + Number(sliderHour))
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(start)
  }, [plan?.departure, form.departure, sliderHour])

  function update(field, value) { setForm((old) => ({ ...old, [field]: value })) }

  function useCurrentLocation() {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError('This browser does not provide location access. Search for an origin address instead.')
      return
    }
    if (!window.isSecureContext) {
      setLocationError('Location access requires a secure page. Open the app through HTTPS or localhost, then try again.')
      return
    }
    setLocatingOrigin(true)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const lat = Number(coords.latitude.toFixed(6))
      const lon = Number(coords.longitude.toFixed(6))
      const place = { lat, lon, label: 'My current location', country: '', type: 'Device location', isCurrentLocation: true, accuracyMeters: Math.round(coords.accuracy) }
      setForm((old) => ({ ...old, originQuery: place.label, origin: place }))
      try {
        const resolvedLabel = await reverseGeocodeLocation(lat, lon)
        if (resolvedLabel) {
          setForm((old) => old.origin?.isCurrentLocation && old.origin.lat === lat && old.origin.lon === lon
            ? { ...old, originQuery: resolvedLabel, origin: { ...old.origin, label: resolvedLabel } }
            : old)
        }
      } catch {
        // Keep the readable generic label; coordinates stay available for routing.
      } finally {
        setLocatingOrigin(false)
      }
    }, (geoError) => {
      const message = geoError.code === geoError.PERMISSION_DENIED
        ? 'The browser or device is blocking location access. In site settings beside the address bar, set Location to Allow, then reload and try again.'
        : geoError.code === geoError.TIMEOUT
          ? 'Your location took too long to load. Try again or search for an origin address.'
          : 'Your location is unavailable right now. Try again or search for an origin address.'
      setLocationError(message)
      setLocatingOrigin(false)
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.origin || !form.destination) {
      setError('Choose an origin and destination from the address suggestions before planning.')
      return
    }
    setLoading(true)
    setError('')
    setPlan(null)
    try {
      const result = await planTrip({ origin: form.origin, destination: form.destination, departure: new Date(form.departure).toISOString(), loadWeight: Number(form.loadWeight), spacingMiles: Number(form.spacingMiles) })
      setPlan(result)
      setSelectedRouteId(result.recommendedRouteId || result.routes[0]?.id || null)
      setSliderHour(0)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="StormHaul home"><span className="brand-mark"><CloudSun size={20} strokeWidth={2.2} /></span><span>storm<span className="brand-light">haul</span></span></a>
      <div className="topbar-center"><span className="live-dot" /> WEATHER-AWARE ROUTING <span className="topbar-divider">/</span> TRUCK SAFETY</div>
      <div className="topbar-right"><span className="status-icon"><ShieldCheck size={15} /></span><span>Route intelligence</span><span className="avatar">SH</span></div>
    </header>

    <section className="intro" id="top">
      <div className="intro-copy"><div className="eyebrow"><span className="eyebrow-line" /> PLAN WITH THE CONDITIONS IN MIND</div><h1>Every mile, <em>in view.</em></h1><p>Compare truck routes against weather at your estimated arrival time. Find the safer way to get there.</p></div>
      <div className="intro-stamp"><span className="stamp-icon"><Navigation size={18} /></span><div><strong>Built for the long haul</strong><small>Route · Forecast · Decide</small></div></div>
    </section>

    <section className="planner-card">
      <form onSubmit={handleSubmit}>
        <div className="form-heading"><div><span className="section-kicker">TRIP DETAILS</span><h2>Where are you headed?</h2></div><span className="units-note">All distances in miles · Weight in lb</span></div>
        <div className="input-grid">
          <AddressAutocomplete className="origin-field" label="ORIGIN" value={form.origin?.label || form.originQuery} selectedPlace={form.origin} placeholder="Warehouse, yard, street, city, or postal code" onValueChange={(value) => { setLocationError(''); setForm((old) => ({ ...old, originQuery: value, origin: null })) }} onSelect={(place) => { setLocationError(''); setForm((old) => ({ ...old, originQuery: place.label, origin: place })) }} onUseCurrentLocation={useCurrentLocation} onPickFromMap={() => setMapPicker({ field: 'origin', initialPlace: form.origin })} locating={locatingOrigin} />
          <div className="swap-wrap"><button type="button" aria-label="Swap origin and destination" className="swap-button" onClick={() => setForm((old) => ({ ...old, originQuery: old.destinationQuery, destinationQuery: old.originQuery, origin: old.destination, destination: old.origin }))}><ArrowLeftRight size={16} /></button></div>
          <AddressAutocomplete className="destination-field" label="DESTINATION" value={form.destination?.label || form.destinationQuery} selectedPlace={form.destination} placeholder="Dock, street, city, or postal code" biasPlace={form.origin} onValueChange={(value) => setForm((old) => ({ ...old, destinationQuery: value, destination: null }))} onSelect={(place) => setForm((old) => ({ ...old, destinationQuery: place.label, destination: place }))} onPickFromMap={() => setMapPicker({ field: 'destination', initialPlace: form.destination })} />
          <label className="field departure-field"><span>DEPARTURE</span><div className="input-icon"><CalendarDays size={16} /><input type="datetime-local" required value={form.departure} onChange={(e) => update('departure', e.target.value)} /></div></label>
          <label className="field weight-field"><span>LOAD WEIGHT</span><div className="input-icon"><Truck size={17} /><input type="number" required min="0" max="200000" step="100" value={form.loadWeight} onChange={(e) => update('loadWeight', e.target.value)} /><b className="unit-suffix">lb</b></div></label>
        </div>
        <div className="routing-note">Load weight is used for weather-risk rules. Road restrictions use TomTom's truck profile; this form does not collect vehicle dimensions or gross weight.</div>
        <div className="form-bottom"><div className="spacing-control"><SlidersHorizontal size={15} /><span>CHECKPOINT SPACING</span><div className="segmented">{[10, 25, 50].map((miles) => <button type="button" className={Number(form.spacingMiles) === miles ? 'segment active' : 'segment'} key={miles} onClick={() => update('spacingMiles', miles)}>{miles} mi</button>)}</div></div>
          <button className="submit-button" type="submit" disabled={loading}>{loading ? <><span className="spinner" /> Scanning routes…</> : <>Find safer routes <ArrowRight size={17} /></>}</button>
        </div>
      </form>
      {apiStatus === 'missing-key' && <div className="setup-note"><span>i</span> Routing API connection is not configured yet. Add the TomTom key to the backend environment to plan a trip.</div>}
      {apiStatus === 'offline' && <div className="error-note"><span>!</span>The planning API is not reachable. Start Django locally or check the deployed backend URL.</div>}
      {locationError && <div className="error-note" role="alert"><span>!</span>{locationError}</div>}
      {error && <div className="error-note" role="alert"><span>!</span>{error}</div>}
    </section>

    {mapPicker && <MapLocationPicker key={mapPicker.field} field={mapPicker.field} initialPlace={mapPicker.initialPlace} nearbyPlace={mapPicker.field === 'destination' ? form.origin : form.destination} onClose={() => setMapPicker(null)} onChoose={(place) => {
      const queryField = mapPicker.field === 'origin' ? 'originQuery' : 'destinationQuery'
      setForm((old) => ({ ...old, [queryField]: place.label, [mapPicker.field]: place }))
      setLocationError('')
      setError('')
      setMapPicker(null)
    }} />}

    {plan ? <>
      <div className="results-head"><div><div className="section-kicker">ROUTE ANALYSIS <span className="head-dot" /></div><h2>{plan.origin.label} <ArrowRight size={19} /> {plan.destination.label}</h2></div><div className="results-meta"><span><CalendarDays size={15} /> {formatDate(plan.departure)}</span><span><Clock3 size={15} /> {formatClock(plan.departure)}</span><span><Truck size={15} /> {Number(plan.loadWeightLbs).toLocaleString()} lb load</span></div></div>
      {plan.routeNotice && <div className="notice-banner"><span>i</span>{plan.routeNotice}</div>}
      {plan.recommendationNotice && <div className="notice-banner"><span>i</span>{plan.recommendationNotice}</div>}
      {plan.origin.isCurrentLocation && <div className="live-trip-banner"><span className="live-dot" />{isRerouting ? 'You are off the planned route. Recalculating routes and weather from your current location…' : 'Live trip mode follows your device, updates remaining distance and ETA, and recalculates if you stay more than 1.5 miles off route. Checkpoint weather is refreshed when the route recalculates.'}</div>}
      {plan.origin.isCurrentLocation && liveError && <div className="error-note" role="status"><span>!</span>{liveError}</div>}
      <section className="results-grid">
        <div className="map-panel">
          <div className="panel-header"><div><span className="section-kicker">WEATHER CORRIDOR</span><h3>Conditions along the way</h3></div><div className="map-live"><span className="live-dot" /> {plan.origin.isCurrentLocation ? 'LIVE TRIP' : 'FORECAST LAYER'}</div></div>
          <div className="map-controls"><div className="forecast-title"><CloudDrizzle size={16} /><span>Forecast time</span><strong>{sliderLabel}</strong></div><div className="slider-row"><span>0h</span><input aria-label="Forecast hour" type="range" min="0" max="48" value={sliderHour} onChange={(e) => setSliderHour(Number(e.target.value))} /><span>48h</span></div><div className="slider-ticks"><span>Departure</span><span>+12 hours</span><span>+24 hours</span><span>+36 hours</span><span>+48 hours</span></div></div>
          <WeatherMap routes={plan.routes} origin={plan.origin} destination={plan.destination} liveLocation={plan.origin.isCurrentLocation ? livePosition : null} selectedRouteId={selectedRoute?.id} onSelectRoute={setSelectedRouteId} sliderHour={sliderHour} loadWeightLbs={plan.loadWeightLbs} />
          <div className="map-footer"><span><i className="heat-icon" /> Forecast risk along the selected route at the slider time; colors combine wind, rain, and snow</span><span>{plan.origin.isCurrentLocation ? 'Dashed line connects your exact GPS start to the truck-road snap point. ' : ''}Click weather points for values or the start/end markers for road-snapped points · Routing: <a href="https://www.tomtom.com/" target="_blank" rel="noreferrer">TomTom</a> · Weather: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> · Heat samples every 15 miles</span></div>
        </div>
        <aside className="route-column">
          <div className="route-column-head"><div><span className="section-kicker">YOUR OPTIONS</span><h3>Choose a route</h3></div><span className="option-count">{plan.routes.length} FOUND</span></div>
          <div className="route-list">{plan.routes.map((route, index) => <RouteCard key={route.id} route={route} number={index + 1} liveLocation={plan.origin.isCurrentLocation ? livePosition : null} recommended={route.id === plan.recommendedRouteId} selected={route.id === selectedRoute?.id} onClick={() => setSelectedRouteId(route.id)} />)}</div>
          <div className="recommendation-rule"><span className="rule-icon"><Check size={15} /></span><span>Routes are ranked by No Travel conditions, severe miles, high miles, average risk, then travel time.</span></div>
        </aside>
      </section>

      {selectedRoute && <section className="checkpoint-panel">
        <div className="checkpoint-head"><div><span className="section-kicker">CHECKPOINT DETAIL</span><h3>{selectedRoute.label}<span className="checkpoint-subtitle"> · Every {plan.spacingMiles} miles</span></h3></div><div className="checkpoint-count"><Activity size={15} /> {selectedRoute.checkpoints.length} points</div></div>
        <div className="checkpoint-table-wrap"><table className="checkpoint-table"><thead><tr><th>LOCATION</th><th>ARRIVAL</th><th>WIND</th><th>RAIN / HR</th><th>SNOW / HR</th><th>RISK</th><th>RISK MILES</th></tr></thead><tbody>{selectedRoute.checkpoints.map((point, index) => <tr key={`${point.offsetMiles}-${index}`}><td><span className="table-mile"><span className="checkpoint-node" />{point.offsetMiles < 1 ? 'Origin' : point.offsetMiles.toFixed(0) + ' mi'}</span></td><td>{formatDate(point.eta)} · {formatClock(point.eta)}</td><td>{point.weather?.windMph != null ? <>{Math.round(point.weather.windMph)} <small>mph</small></> : '—'}</td><td>{point.weather?.rainInHr != null ? `${point.weather.rainInHr.toFixed(2)} in` : '—'}</td><td>{point.weather?.snowInHr != null ? `${point.weather.snowInHr.toFixed(2)} in` : '—'}</td><td><RiskBadge risk={point.risk} /></td><td>{point.riskMiles.toFixed(1)} mi</td></tr>)}</tbody></table></div>
      </section>}
    </> : <section className="empty-state"><div className="empty-illustration"><div className="sun-disc" /><div className="road-line" /><div className="empty-pin"><MapPin size={22} /></div><div className="empty-cloud"><CloudSun size={24} /></div></div><span className="section-kicker">A CLEARER PICTURE AHEAD</span><h2>Start with your trip details.</h2><p>Your route options, weather checkpoints, and risk summary will appear here.</p><div className="empty-chips"><span><Compass size={14} /> Truck-aware routes</span><span><Wind size={14} /> Arrival-time forecasts</span><span><Gauge size={14} /> Risk by mile</span></div></section>}

    <footer className="footer"><div className="footer-brand"><span className="brand-mark small"><CloudSun size={14} /></span> stormhaul</div><span>Forecasts are estimates. Always follow local road closures and official weather advisories.</span><span className="footer-right">© StormHaul <span className="footer-sep">·</span> Built for safer miles</span></footer>
  </main>
}

function RouteCard({ route, number, liveLocation, recommended, selected, onClick }) {
  const summary = route.summary
  const liveMetrics = liveLocation ? getLiveRouteMetrics(route, liveLocation) : null
  return <button className={`route-card ${selected ? 'selected' : ''}`} onClick={onClick}>
    <div className="route-card-top"><span className={`route-number n${number}`}>0{number}</span><div className="route-name"><strong>{route.label}</strong><small>{recommended ? 'Recommended' : route.source?.endsWith('candidate') ? 'Preference-based candidate' : `Option ${number}`}</small></div>{recommended && <span className="recommended-tag"><Check size={12} /> BEST</span>}</div>
    <div className="route-stats"><div><strong>{formatDuration(liveMetrics?.remainingSeconds ?? route.durationSeconds)}</strong><small>{liveMetrics ? 'TIME LEFT' : 'TRAVEL TIME'}</small></div><div><strong>{(liveMetrics?.remainingMiles ?? route.distanceMiles).toLocaleString(undefined, { maximumFractionDigits: 1 })} <small>mi</small></strong><small>{liveMetrics ? 'LEFT' : 'DISTANCE'}</small></div><div><strong>{formatClock(liveMetrics?.eta || route.eta)}</strong><small>{liveMetrics ? 'LIVE ETA' : 'ARRIVAL'}</small></div></div>
    <div className="route-risk-strip"><RiskBadge risk={summary.noTravelMiles > 0 ? 'no-travel' : summary.severeMiles > 0 ? 'severe' : summary.highMiles > 0 ? 'high' : 'low'} /><span>{summary.severeMiles.toFixed(0)} severe mi</span><span className="risk-separator">·</span><span>{summary.highMiles.toFixed(0)} high mi</span><span className="risk-separator">·</span><span>avg {summary.averageRisk == null ? '—' : `${summary.averageRisk.toFixed(2)}/4`}</span>{summary.noTravelMiles > 0 && <><span className="risk-separator">·</span><span>{summary.noTravelMiles.toFixed(0)} no travel</span></>}</div>
  </button>
}

function RiskBadge({ risk }) { return <span className={`risk-badge badge-${risk}`}><i />{riskLabel(risk)}</span> }

export default App
