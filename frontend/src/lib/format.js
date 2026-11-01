export function formatDuration(seconds = 0) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function formatClock(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function formatDate(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso))
}

export function riskLabel(risk = 'unavailable') {
  return ({ 'no-travel': 'No travel', low: 'Low', moderate: 'Moderate', high: 'High', severe: 'Severe', unavailable: 'Unavailable' })[risk] || 'Unavailable'
}

export function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function formatRiskBreakdown(point, loadWeightLbs = 28000) {
  if (point?.breakdown) return point.breakdown
  const weather = point?.weather
  if (!weather || weather.windMph == null) return 'No weather risk · No load risk'
  const wind = weather.windMph || 0
  const rain = weather.rainInHr || 0
  const snow = weather.snowInHr || 0
  const load = Number(loadWeightLbs) || 28000

  const reasons = []

  if (wind >= 55) {
    reasons.push(`NO TRAVEL: Wind ${Math.round(wind)} mph ≥ 55 mph (all loads)`)
  } else if (wind >= 45) {
    if (load > 30000) {
      reasons.push(`NO TRAVEL: Wind ${Math.round(wind)} mph + Load ${load.toLocaleString()} lb (>30,000 lb rule)`)
    } else {
      reasons.push(`Severe wind ${Math.round(wind)} mph (45–54 mph)`)
    }
  } else if (wind >= 35) {
    if (load > 40000) {
      reasons.push(`Severe risk: Wind ${Math.round(wind)} mph + Load ${load.toLocaleString()} lb (>40,000 lb rule)`)
    } else {
      reasons.push(`High wind ${Math.round(wind)} mph (35–44 mph)`)
    }
  } else if (wind >= 25) {
    reasons.push(`Moderate wind ${Math.round(wind)} mph (25–34 mph)`)
  }

  if (rain > 1.0) {
    reasons.push(`NO TRAVEL: Rain ${rain.toFixed(2)} in/hr > 1.00 in/hr`)
  } else if (rain >= 0.5) {
    reasons.push(`Severe rain ${rain.toFixed(2)} in/hr (0.50–1.00 in/hr)`)
  } else if (rain >= 0.25) {
    reasons.push(`High rain ${rain.toFixed(2)} in/hr (0.25–0.50 in/hr)`)
  } else if (rain >= 0.10) {
    reasons.push(`Moderate rain ${rain.toFixed(2)} in/hr (0.10–0.25 in/hr)`)
  }

  if (snow > 3.0) {
    reasons.push(`NO TRAVEL: Snow ${snow.toFixed(2)} in/hr > 3.0 in/hr`)
  } else if (snow >= 2.0) {
    reasons.push(`Severe snow ${snow.toFixed(2)} in/hr (2.0–3.0 in/hr)`)
  } else if (snow >= 1.0) {
    reasons.push(`High snow ${snow.toFixed(2)} in/hr (1.0–2.0 in/hr)`)
  } else if (snow >= 0.5) {
    reasons.push(`Moderate snow ${snow.toFixed(2)} in/hr (0.5–1.0 in/hr)`)
  }

  if (reasons.length === 0) {
    return `No weather risk · No load risk (Wind ${Math.round(wind)} mph)`
  }
  return reasons.join(' · ')
}
