import { useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock3,
  CloudDrizzle,
  CloudRain,
  CloudSun,
  Crosshair,
  Edit3,
  MapPin,
  MapPinned,
  Navigation,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Truck,
  Wind,
  X
} from 'lucide-react'
import WeatherMap from './WeatherMap.jsx'
import AddressAutocomplete from './AddressAutocomplete.jsx'
import { formatClock, formatDate, formatDuration, riskLabel } from '../lib/format.js'
import { getLiveRouteMetrics } from '../lib/live.js'

export default function MobileMapApp({
  form,
  setForm,
  plan,
  selectedRoute,
  selectedRouteId,
  setSelectedRouteId,
  sliderHour,
  setSliderHour,
  sliderLabel,
  loading,
  error,
  locationError,
  locatingOrigin,
  useCurrentLocation,
  onPickFromMap,
  onSubmit,
  livePosition,
  liveError,
  isRerouting,
  updateFormField,
}) {
  const [sheetState, setSheetState] = useState('peek') // 'peek' | 'expanded'
  const [initialDrawerState, setInitialDrawerState] = useState('peek') // 'peek' | 'expanded'
  const [isEditingTrip, setIsEditingTrip] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [simWeight, setSimWeight] = useState(Number(form.loadWeight) || 34000)

  const hasPlan = Boolean(plan && plan.routes && plan.routes.length > 0)
  const showTripForm = !hasPlan || isEditingTrip

  const liveMetrics = livePosition && selectedRoute ? getLiveRouteMetrics(selectedRoute, livePosition) : null

  function handleRouteSelect(routeId) {
    setSelectedRouteId(routeId)
  }

  function handleApplyWeight(weight) {
    setSimWeight(weight)
    setForm((prev) => ({ ...prev, loadWeight: weight }))
  }

  function toggleSheet() {
    setSheetState((current) => (current === 'peek' ? 'expanded' : 'peek'))
  }

  return (
    <div className="mobile-app-root">
      {/* 1. Full-Bleed Map Canvas */}
      <div className="mobile-map-canvas-wrap">
        <WeatherMap
          routes={plan?.routes || []}
          origin={form.origin}
          destination={form.destination}
          liveLocation={livePosition}
          selectedRouteId={selectedRouteId}
          onSelectRoute={handleRouteSelect}
          sliderHour={sliderHour}
          loadWeightLbs={plan?.loadWeightLbs || Number(form.loadWeight) || 28000}
          isInitial={!hasPlan}
        />
      </div>

      {/* Floating GPS Recenter FAB Button */}
      {livePosition && (
        <button
          type="button"
          className="mobile-fab-gps"
          aria-label="Re-center my location"
          onClick={useCurrentLocation}
        >
          <Crosshair size={20} />
        </button>
      )}

      {/* 2. Floating Top Search Card or Compact Route Bar */}
      <div className="mobile-top-overlay">
        {showTripForm ? (
          !searchOpen ? (
            /* Collapsed search pill — Google Maps style */
            <div className="mobile-search-pill" onClick={() => setSearchOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSearchOpen(true)}>
              <span className="mobile-search-pill-icon"><CloudSun size={20} /></span>
              <span className="mobile-search-pill-text">Where to?</span>
              <span className="mobile-search-pill-arrow"><Search size={18} /></span>
            </div>
          ) : (
            <div className="mobile-trip-card">
              <div className="mobile-trip-card-header">
                <button
                  type="button"
                  className="mobile-back-btn"
                  onClick={() => { setSearchOpen(false); if (isEditingTrip) setIsEditingTrip(false) }}
                  aria-label="Collapse search"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="mobile-brand-pill">
                  <CloudSun size={17} className="brand-icon-sun" />
                  <span>StormHaul</span>
                </div>
                {hasPlan && (
                  <button
                    type="button"
                    className="mobile-btn-close-edit"
                    onClick={() => { setIsEditingTrip(false); setSearchOpen(false) }}
                    aria-label="Close edit"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

            <form
              onSubmit={(e) => {
                setIsEditingTrip(false)
                setSearchOpen(false)
                onSubmit(e)
              }}
            >
              <div className="mobile-inputs-box">
                {/* Origin Field */}
                <div className="mobile-input-row">
                  <span className="dot-pin origin-dot" />
                  <div className="mobile-autocomplete-wrap">
                    <AddressAutocomplete
                      label="ORIGIN"
                      value={form.origin?.label || form.originQuery}
                      selectedPlace={form.origin}
                      placeholder="Current location or origin address"
                      onValueChange={(val) => setForm((old) => ({ ...old, originQuery: val, origin: null }))}
                      onSelect={(place) => setForm((old) => ({ ...old, originQuery: place.label, origin: place }))}
                      onUseCurrentLocation={useCurrentLocation}
                      onPickFromMap={() => onPickFromMap('origin')}
                      locating={locatingOrigin}
                    />
                  </div>
                </div>

                <div className="mobile-inputs-divider" />

                {/* Destination Field */}
                <div className="mobile-input-row">
                  <span className="dot-pin destination-dot" />
                  <div className="mobile-autocomplete-wrap">
                    <AddressAutocomplete
                      label="DESTINATION"
                      value={form.destination?.label || form.destinationQuery}
                      selectedPlace={form.destination}
                      placeholder="Dock, street, city, or postal code"
                      biasPlace={form.origin}
                      onValueChange={(val) => setForm((old) => ({ ...old, destinationQuery: val, destination: null }))}
                      onSelect={(place) => setForm((old) => ({ ...old, destinationQuery: place.label, destination: place }))}
                      onPickFromMap={() => onPickFromMap('destination')}
                    />
                  </div>
                </div>
              </div>

              {/* Trip Settings Row */}
              <div className="mobile-settings-row">
                <label className="mobile-setting-pill">
                  <CalendarDays size={14} />
                  <input
                    type="datetime-local"
                    required
                    value={form.departure}
                    onChange={(e) => updateFormField('departure', e.target.value)}
                  />
                </label>

                <label className="mobile-setting-pill">
                  <Truck size={14} />
                  <input
                    type="number"
                    min="0"
                    max="200000"
                    step="100"
                    value={form.loadWeight}
                    onChange={(e) => updateFormField('loadWeight', e.target.value)}
                  />
                  <span>lb</span>
                </label>
              </div>

              {/* Checkpoint Spacing & Submit */}
              <div className="mobile-form-actions">
                <div className="mobile-spacing-pills">
                  {[10, 25, 50].map((mi) => (
                    <button
                      key={mi}
                      type="button"
                      className={`mobile-spacing-btn ${Number(form.spacingMiles) === mi ? 'active' : ''}`}
                      onClick={() => updateFormField('spacingMiles', mi)}
                    >
                      {mi} mi
                    </button>
                  ))}
                </div>

                <button type="submit" className="mobile-btn-plan" disabled={loading}>
                  {loading ? (
                    'Scanning weather corridors...'
                  ) : (
                    <>
                      <span>Find safest routes</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>

              {error && <div className="mobile-error-banner">{error}</div>}
              {locationError && <div className="mobile-error-banner">{locationError}</div>}
            </form>
          </div>
          )
        ) : (
          /* Compact Active Route Bar + Floating Forecast Slider directly below it */
          <div className="mobile-top-group">
            <div className="mobile-compact-bar" onClick={() => { setIsEditingTrip(true); setSearchOpen(true) }}>
              <div className="mobile-compact-summary">
                <div className="mobile-compact-endpoints">
                  <span className="dot-pin origin-dot" />
                  <span className="compact-label">{form.origin?.label || 'Origin'}</span>
                  <ArrowRight size={13} className="compact-arrow" />
                  <span className="dot-pin destination-dot" />
                  <span className="compact-label">{form.destination?.label || 'Destination'}</span>
                </div>
                <div className="mobile-compact-sub">
                  <span>{Number(form.loadWeight).toLocaleString()} lb</span>
                  <span>·</span>
                  <span>Every {form.spacingMiles} mi</span>
                </div>
              </div>
              <button type="button" className="mobile-btn-edit-pill">
                <Edit3 size={13} />
                <span>Edit</span>
              </button>
            </div>

            {/* Weather Forecast Time Slider — Placed separately just below the origin/destination bar */}
            <div className="mobile-top-slider-card">
              <div className="mobile-slider-head">
                <div className="mobile-slider-title">
                  <CloudDrizzle size={15} className="mobile-slider-icon" />
                  <span>Corridor Forecast</span>
                </div>
                <strong className="mobile-slider-time">{sliderLabel}</strong>
              </div>
              <div className="mobile-slider-track-wrap">
                <input
                  type="range"
                  min="0"
                  max="48"
                  value={sliderHour}
                  onChange={(e) => setSliderHour(Number(e.target.value))}
                  className="mobile-forecast-range"
                  aria-label="Corridor weather forecast hour"
                />
                <div className="mobile-slider-labels">
                  <span>Departure (0h)</span>
                  <span>+12h</span>
                  <span>+24h</span>
                  <span>+36h</span>
                  <span>+48h</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Google Maps Bottom Sheet (Visible once routes are found) */}
      {hasPlan && !showTripForm && (
        <div className={`mobile-bottom-sheet sheet-${sheetState}`}>
          {/* Sheet Handle */}
          <div className="mobile-sheet-handle-wrap" onClick={toggleSheet}>
            <div className="mobile-sheet-handle-bar" />
          </div>

          {/* Quick Route Switcher Bar */}
          <div className="mobile-route-selector-scroll">
            {plan.routes.map((route, idx) => {
              const isSelected = route.id === selectedRoute?.id
              const isRecommended = route.id === plan.recommendedRouteId
              return (
                <button
                  key={route.id}
                  type="button"
                  className={`mobile-route-pill-btn ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleRouteSelect(route.id)}
                >
                  <span className="pill-number">0{idx + 1}</span>
                  <div className="pill-content">
                    <strong>{formatDuration(route.durationSeconds)}</strong>
                    <small>{route.distanceMiles} mi</small>
                  </div>
                  {isRecommended && <span className="pill-best-tag">BEST</span>}
                </button>
              )
            })}
          </div>

          {/* Selected Route Primary Stats (Peek View Header) */}
          {selectedRoute && (
            <div className="mobile-peek-summary" onClick={toggleSheet}>
              <div className="peek-main">
                <div className="peek-eta-row">
                  <span className="peek-duration">
                    {formatDuration(liveMetrics?.remainingSeconds ?? selectedRoute.durationSeconds)}
                  </span>
                  <span className="peek-distance">
                    {(liveMetrics?.remainingMiles ?? selectedRoute.distanceMiles).toFixed(0)} mi
                  </span>
                  <span className="peek-arrival">
                    ETA {formatClock(liveMetrics?.eta || selectedRoute.eta)}
                  </span>
                </div>
                <div className="peek-risk-row">
                  <span className={`risk-pill risk-${selectedRoute.summary.noTravelMiles > 0 ? 'no-travel' : selectedRoute.summary.severeMiles > 0 ? 'severe' : selectedRoute.summary.highMiles > 0 ? 'high' : 'low'}`}>
                    {riskLabel(selectedRoute.summary.noTravelMiles > 0 ? 'no-travel' : selectedRoute.summary.severeMiles > 0 ? 'severe' : selectedRoute.summary.highMiles > 0 ? 'high' : 'low')}
                  </span>
                  <span className="peek-risk-text">
                    {selectedRoute.summary.severeMiles > 0
                      ? `${selectedRoute.summary.severeMiles.toFixed(0)} severe mi`
                      : selectedRoute.summary.highMiles > 0
                      ? `${selectedRoute.summary.highMiles.toFixed(0)} high mi`
                      : 'Clear weather conditions'}
                  </span>
                </div>
              </div>
              <button type="button" className="mobile-sheet-toggle-btn" aria-label="Toggle details">
                {sheetState === 'peek' ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
          )}

          {/* Expanded Drawer Details (Weather slider, metrics, and milestones) */}
          <div className="mobile-sheet-scrollable-content">
            {/* Live Mode Notice */}
            {plan.origin.isCurrentLocation && (
              <div className="mobile-live-banner">
                <Navigation size={14} className="live-spin" />
                <span>
                  {isRerouting
                    ? 'Off route detected. Recalculating path...'
                    : 'Live GPS navigation mode active. Auto-reroutes if off-track.'}
                </span>
              </div>
            )}
            {liveError && <div className="mobile-error-banner">{liveError}</div>}

            {/* Route Risk Comparison Badges */}
            {selectedRoute && (
              <div className="mobile-metrics-grid">
                <div className="metric-chip">
                  <small>SEVERE RISK</small>
                  <strong className={selectedRoute.summary.severeMiles > 0 ? 'danger-val' : ''}>
                    {selectedRoute.summary.severeMiles.toFixed(1)} mi
                  </strong>
                </div>
                <div className="metric-chip">
                  <small>HIGH RISK</small>
                  <strong className={selectedRoute.summary.highMiles > 0 ? 'warning-val' : ''}>
                    {selectedRoute.summary.highMiles.toFixed(1)} mi
                  </strong>
                </div>
                <div className="metric-chip">
                  <small>AVG RISK SCORE</small>
                  <strong>
                    {selectedRoute.summary.averageRisk != null ? `${selectedRoute.summary.averageRisk.toFixed(2)} / 4` : '—'}
                  </strong>
                </div>
                <div className="metric-chip">
                  <small>TRAFFIC DELAY</small>
                  <strong>
                    {selectedRoute.trafficDelaySeconds > 0 ? formatDuration(selectedRoute.trafficDelaySeconds) : '0 min'}
                  </strong>
                </div>
              </div>
            )}

            {/* Step-by-Step Google Maps-style Weather Milestones */}
            {selectedRoute && (
              <div className="mobile-timeline-section">
                <div className="timeline-section-title">
                  <span>CORRIDOR CHECKPOINTS</span>
                  <small>{selectedRoute.checkpoints.length} points · every {plan.spacingMiles} mi</small>
                </div>

                <div className="mobile-timeline-list">
                  {selectedRoute.checkpoints.map((point, index) => {
                    const isOrigin = index === 0
                    const isDest = index === selectedRoute.checkpoints.length - 1
                    return (
                      <div key={`${point.offsetMiles}-${index}`} className="mobile-timeline-item">
                        {/* Vertical connection track */}
                        <div className="timeline-track">
                          <span className={`timeline-dot dot-${point.risk} ${isOrigin ? 'start-dot' : ''} ${isDest ? 'end-dot' : ''}`} />
                          {!isDest && <span className="timeline-line" />}
                        </div>

                        {/* Milestone Card */}
                        <div className="timeline-content-card">
                          <div className="timeline-card-top">
                            <strong>{isOrigin ? 'Trip Origin' : isDest ? 'Destination' : `${point.offsetMiles.toFixed(0)} miles`}</strong>
                            <span className="timeline-clock">{formatDate(point.eta)} · {formatClock(point.eta)}</span>
                            <span className={`risk-badge-mini risk-${point.risk}`}>{riskLabel(point.risk)}</span>
                          </div>

                          <div className="timeline-card-weather">
                            <span>
                              Wind: <strong>{point.weather?.windMph != null ? `${Math.round(point.weather.windMph)} mph` : '—'}</strong>
                            </span>
                            <span>
                              Rain: <strong>{point.weather?.rainInHr != null ? `${point.weather.rainInHr.toFixed(2)} in/h` : '—'}</strong>
                            </span>
                            <span>
                              Snow: <strong>{point.weather?.snowInHr != null ? `${point.weather.snowInHr.toFixed(2)} in/h` : '—'}</strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Initial Truck Dispatch & Weather Thresholds Drawer */}
      {!hasPlan && !searchOpen && (
        <div className={`mobile-bottom-sheet mobile-initial-sheet sheet-${initialDrawerState}`}>
          {/* Sheet Handle */}
          <div
            className="mobile-sheet-handle-wrap"
            onClick={() => setInitialDrawerState((s) => (s === 'peek' ? 'expanded' : 'peek'))}
          >
            <div className="mobile-sheet-handle-bar" />
          </div>

          <div className="mobile-initial-scroll-wrap">
            {/* Header / Summary */}
            <div
              className="mobile-initial-head"
              onClick={() => setInitialDrawerState((s) => (s === 'peek' ? 'expanded' : 'peek'))}
            >
              <div className="mobile-initial-title-wrap">
                <span className="mobile-initial-kicker">TRUCK DISPATCH INTELLIGENCE</span>
                <h3 className="mobile-initial-title">Weather Safety Thresholds</h3>
              </div>
              <button
                type="button"
                className="mobile-initial-expand-btn"
                aria-label="Toggle details"
              >
                {initialDrawerState === 'expanded' ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
            </div>

            {/* Quick Action Buttons (GPS, Map Pick, Plan Route) */}
            <div className="mobile-initial-actions-row">
              <button
                type="button"
                className="mobile-quick-action-pill"
                onClick={useCurrentLocation}
                disabled={locatingOrigin}
              >
                <Crosshair size={14} className="action-pill-icon" />
                <span>{locatingOrigin ? 'Locating...' : 'Use My GPS'}</span>
              </button>

              <button
                type="button"
                className="mobile-quick-action-pill"
                onClick={() => onPickFromMap('origin')}
              >
                <MapPinned size={14} className="action-pill-icon" />
                <span>Pick On Map</span>
              </button>

              <button
                type="button"
                className="mobile-quick-action-pill primary-pill"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={14} />
                <span>Plan Route</span>
              </button>
            </div>

            {/* Live Threshold Rules Strip */}
            <div className="mobile-rules-summary-strip">
              <span className="summary-rule-tag tag-notravel">Wind &ge;55 mph &middot; No Travel</span>
              <span className="summary-rule-tag tag-severe">Rain &gt;0.5 in/h &middot; Severe</span>
              <span className="summary-rule-tag tag-snow">Snow &gt;2.0 in/h &middot; Severe</span>
            </div>

            {/* Expanded Section: Interactive Load Weight Simulator & Full Risk Rules */}
            <div className="mobile-initial-expanded-content">
              {/* Interactive Load Weight Simulator */}
              <div className="mobile-weight-simulator-card">
                <div className="simulator-head">
                  <Truck size={16} className="simulator-icon" />
                  <strong>Truck Load Risk Simulator</strong>
                </div>
                <p className="simulator-desc">
                  Wind thresholds adjust automatically based on gross vehicle weight:
                </p>

                <div className="weight-preset-chips">
                  {[
                    { label: '15,000 lb (Empty)', val: 15000 },
                    { label: '34,000 lb (Standard)', val: 34000 },
                    { label: '45,000 lb (Heavy Haul)', val: 45000 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      className={`weight-chip ${simWeight === preset.val ? 'selected' : ''}`}
                      onClick={() => handleApplyWeight(preset.val)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className={`simulator-alert ${simWeight > 40000 ? 'alert-heavy' : simWeight > 30000 ? 'alert-medium' : 'alert-light'}`}>
                  {simWeight > 40000 ? (
                    <>
                      <strong>⚠️ Heavy Rig Rule Active ({simWeight.toLocaleString()} lb)</strong>
                      <span>Winds of 35–44 mph escalate to SEVERE risk due to rollover hazard.</span>
                    </>
                  ) : simWeight > 30000 ? (
                    <>
                      <strong>⛔ Loaded Rig Rule Active ({simWeight.toLocaleString()} lb)</strong>
                      <span>Winds of 45–54 mph mandate NO TRAVEL. Rigs must hold at terminal.</span>
                    </>
                  ) : (
                    <>
                      <strong>🟢 Light Rig ({simWeight.toLocaleString()} lb)</strong>
                      <span>Standard wind thresholds apply. Extreme gusts &ge;55 mph mandate No Travel.</span>
                    </>
                  )}
                </div>
              </div>

              {/* Full Weather Risk Classification Matrix */}
              <div className="mobile-safety-rules-card">
                <div className="safety-card-head">
                  <ShieldAlert size={16} className="safety-card-icon" />
                  <span>Weather Risk Classification Matrix</span>
                </div>
                <div className="safety-rules-grid">
                  <div className="safety-rule-box">
                    <span className="safety-rule-icon"><Wind size={15} /></span>
                    <div>
                      <strong>Wind Speed Limits</strong>
                      <p>&lt;25 mph Low &middot; 25–34 Moderate &middot; 35–44 High &middot; 45–54 Severe &middot; &ge;55 mph No Travel</p>
                    </div>
                  </div>
                  <div className="safety-rule-box">
                    <span className="safety-rule-icon"><CloudRain size={15} /></span>
                    <div>
                      <strong>Rain Intensity</strong>
                      <p>&lt;0.10 in/h Low &middot; 0.10–0.25 Moderate &middot; 0.25–0.50 High &middot; 0.50–1.00 Severe &middot; &gt;1.00 No Travel</p>
                    </div>
                  </div>
                  <div className="safety-rule-box">
                    <span className="safety-rule-icon"><Snowflake size={15} /></span>
                    <div>
                      <strong>Snow Accumulation</strong>
                      <p>&lt;0.5 in/h Low &middot; 0.5–1.0 Moderate &middot; 1.0–2.0 High &middot; 2.0–3.0 Severe &middot; &gt;3.0 No Travel</p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="mobile-btn-plan-now"
                onClick={() => setSearchOpen(true)}
              >
                <Navigation size={16} />
                <span>Enter Origin & Destination</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

