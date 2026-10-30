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
