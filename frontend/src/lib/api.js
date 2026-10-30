const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export async function planTrip(input) {
  const response = await fetch(`${API_BASE}/api/plan/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Unable to plan this trip right now.')
  return payload
}

export async function getHealth() {
  const response = await fetch(`${API_BASE}/api/health/`)
  if (!response.ok) throw new Error('API unavailable')
  return response.json()
}

export async function searchLocations(query, signal, sessionId, biasPlace, fullAddress = false) {
  const params = new URLSearchParams({ q: query })
  if (fullAddress) params.set('full_address', 'true')
  if (sessionId) params.set('session_id', sessionId)
  if (Number.isFinite(Number(biasPlace?.lat)) && Number.isFinite(Number(biasPlace?.lon))) {
    params.set('bias_lat', biasPlace.lat)
    params.set('bias_lon', biasPlace.lon)
  }
  const response = await fetch(`${API_BASE}/api/locations/?${params}`, { signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Address search is unavailable right now.')
  return payload.suggestions || []
}

export async function resolveLocation(place, sessionId) {
  const params = new URLSearchParams({
    id: place.id || '', label: place.label || '', title: place.title || '',
    type: place.detailsType || '', details_id: place.detailsId || '',
    lat: place.lat ?? '', lon: place.lon ?? '', country: place.country || '',
    session_id: sessionId || '',
  })
  const response = await fetch(`${API_BASE}/api/locations/resolve/?${params}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Could not resolve this address. Choose another suggestion.')
  return payload.place
}

export async function reverseGeocodeLocation(lat, lon) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) })
  const response = await fetch(`${API_BASE}/api/locations/reverse/?${params}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Could not name your current location.')
  return payload.label || null
}
