import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import { LoaderCircle, MapPin, X } from 'lucide-react'
import { reverseGeocodeLocation } from '../lib/api.js'

const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const pinIcon = L.divIcon({ className: 'location-picker-icon', html: '<span></span>', iconSize: [28, 36], iconAnchor: [14, 34] })

function MapClickHandler({ onPosition }) {
  useMapEvents({ click(event) { onPosition(event.latlng) } })
  return null
}

export default function MapLocationPicker({ field, initialPlace, nearbyPlace, onClose, onChoose }) {
  const initialPosition = initialPlace ? { lat: initialPlace.lat, lon: initialPlace.lon } : null
  const mapCenter = initialPosition || (nearbyPlace ? { lat: nearbyPlace.lat, lon: nearbyPlace.lon } : null)
  const [point, setPoint] = useState(initialPosition)
  const [label, setLabel] = useState(initialPlace?.label || '')
  const [resolving, setResolving] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const requestId = useRef(0)
  const title = field === 'origin' ? 'Choose origin on map' : 'Choose destination on map'

  useEffect(() => () => { requestId.current += 1 }, [])

  async function updatePoint(nextPoint) {
    const lat = Number(nextPoint.lat.toFixed(6))
    const lon = Number(nextPoint.lng != null ? nextPoint.lng.toFixed(6) : nextPoint.lon.toFixed(6))
    const currentId = ++requestId.current
    setPoint({ lat, lon })
    setLabel('')
    setLookupError('')
    setResolving(true)
    try {
      const resolved = await reverseGeocodeLocation(lat, lon)
      if (currentId === requestId.current) {
        setLabel(resolved || '')
        if (!resolved) setLookupError('No street or place name was found here. You can still use this pin.')
      }
    } catch {
      if (currentId === requestId.current) setLookupError('Could not look up an address here. You can still use this pin.')
    } finally {
      if (currentId === requestId.current) setResolving(false)
    }
  }

  function choosePoint() {
    if (!point) return
    onChoose({
      lat: point.lat,
      lon: point.lon,
      label: label || 'Dropped pin',
      country: '',
      type: label ? 'Address' : 'Pinned location',
      source: 'Mapbox reverse geocoding',
      isCurrentLocation: false,
    })
  }

  return <div className="map-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="map-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="map-picker-title">
      <header className="map-picker-header">
        <div><span className="section-kicker">PIN A TRIP LOCATION</span><h2 id="map-picker-title">{title}</h2><p>Click the map or drag the pin. We’ll find the nearest mapped street or place name.</p></div>
        <button type="button" className="map-picker-close" aria-label="Close map picker" onClick={onClose}><X size={19} /></button>
      </header>
      <div className="map-picker-map">
        <MapContainer key={field} center={mapCenter ? [mapCenter.lat, mapCenter.lon] : [20, 0]} zoom={initialPosition ? 15 : mapCenter ? 12 : 2} scrollWheelZoom className="map-canvas">
          {mapboxToken
            ? <TileLayer attribution="&copy; <a href='https://www.mapbox.com/about/maps/'>Mapbox</a> &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${mapboxToken}`} />
            : <TileLayer attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />}
          <MapClickHandler onPosition={updatePoint} />
          {point && <Marker position={[point.lat, point.lon]} icon={pinIcon} draggable eventHandlers={{ dragend: (event) => updatePoint(event.target.getLatLng()) }} />}
        </MapContainer>
        {!point && <div className="map-picker-hint"><MapPin size={15} /> Click anywhere to drop a pin</div>}
      </div>
      <footer className="map-picker-footer">
        <div className="map-picker-location" aria-live="polite">
          {resolving ? <><LoaderCircle size={15} className="address-spinner" /> Finding the nearest address…</> : <><MapPin size={15} /> {label || lookupError || 'Choose a point on the map'}</>}
        </div>
        <div className="map-picker-actions"><button type="button" className="map-picker-cancel" onClick={onClose}>Cancel</button><button type="button" className="map-picker-confirm" disabled={!point || resolving} onClick={choosePoint}>Use this location</button></div>
      </footer>
    </section>
  </div>
}
