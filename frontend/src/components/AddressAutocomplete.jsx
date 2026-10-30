import { useEffect, useId, useRef, useState } from 'react'
import { Check, LoaderCircle, MapPin, MapPinned, Navigation } from 'lucide-react'
import { resolveLocation, searchLocations } from '../lib/api.js'

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0
    return (char === 'x' ? random : (random & 3 | 8)).toString(16)
  })
}

export default function AddressAutocomplete({ label, value, selectedPlace, placeholder, className = '', onValueChange, onSelect, onUseCurrentLocation, onPickFromMap, locating = false, biasPlace = null }) {
  const listId = useId()
  const sessionId = useRef(createSessionId())
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isFullAddressSearch, setIsFullAddressSearch] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)
  const [searchError, setSearchError] = useState('')

  useEffect(() => {
    const query = value.trim()
    if (selectedPlace) {
      setSuggestions([])
      setIsOpen(false)
      setIsLoading(false)
      setSearchError('')
      return undefined
    }
    if (query.length < 2) {
      setSuggestions([])
      setIsLoading(false)
      setSearchError('')
      return undefined
    }

    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(async () => {
      setIsLoading(true)
      setIsFullAddressSearch(false)
      setSearchError('')
      try {
        let results = await searchLocations(query, controller.signal, sessionId.current, biasPlace)
        if (active && results.length === 0 && query.length >= 6) {
          setIsFullAddressSearch(true)
          results = await searchLocations(query, controller.signal, sessionId.current, biasPlace, true)
        }
        if (active) {
          setSuggestions(results)
          setIsOpen(true)
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') {
          setSuggestions([])
          setIsOpen(true)
          setSearchError(error.message)
        }
      } finally {
        if (active) setIsFullAddressSearch(false)
        if (active) setIsLoading(false)
      }
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [value, selectedPlace, biasPlace?.lat, biasPlace?.lon])

  async function choose(place) {
    const key = place.id || place.label
    setResolvingId(key)
    setSearchError('')
    try {
      const resolved = await resolveLocation(place, sessionId.current)
      onSelect(resolved)
      setSuggestions([])
      setIsOpen(false)
    } catch (error) {
      setSearchError(error.message)
    } finally {
      setResolvingId(null)
    }
  }

  return <div className={`field address-field ${className}`}>
    <div className="address-field-heading"><label className="address-label" htmlFor={listId}>{label}</label>{onPickFromMap && <button type="button" className="map-picker-trigger" onClick={onPickFromMap}><MapPinned size={13} /> Choose on map</button>}</div>
    <div className={`input-icon address-input ${selectedPlace ? 'has-selection' : ''}`}>
      {selectedPlace ? <Check size={17} aria-hidden="true" /> : <MapPin size={17} aria-hidden="true" />}
      <input
        id={listId}
        required
        autoComplete="off"
        maxLength="160"
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId + '-suggestions'}
        aria-describedby={selectedPlace ? listId + '-status' : undefined}
        onFocus={() => { if (!selectedPlace) setIsOpen(true) }}
        onBlur={() => window.setTimeout(() => {
          const field = document.getElementById(listId)?.closest('.address-field')
          if (!field?.contains(document.activeElement)) setIsOpen(false)
        }, 120)}
        onChange={(event) => {
          onValueChange(event.target.value)
          setSuggestions([])
          setSearchError('')
          setIsOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length) {
            event.preventDefault()
            document.getElementById(listId + '-suggestions')?.querySelector('button:not(:disabled)')?.focus()
          } else if (event.key === 'Enter' && isOpen && onUseCurrentLocation) {
            event.preventDefault()
            onUseCurrentLocation()
          } else if (event.key === 'Escape') {
            setIsOpen(false)
          }
        }}
      />
      {isLoading && <LoaderCircle size={15} className="address-spinner" aria-label="Searching places" />}
    </div>
    {selectedPlace && <span className="address-status" id={listId + '-status'}>{selectedPlace.isCurrentLocation ? 'Current location captured from this device' : `Selected ${selectedPlace.country || 'address'}`}</span>}
    {!selectedPlace && <span className="address-hint">Type 2+ characters for address, street, place, or postal-code suggestions</span>}
    {isOpen && !selectedPlace && <div className="address-suggestions" id={listId + '-suggestions'} role="listbox" aria-label={`${label.toLowerCase()} suggestions`}>
      {onUseCurrentLocation && <button type="button" role="option" aria-selected="false" className="address-suggestion current-location-option" disabled={locating} onMouseDown={(event) => event.preventDefault()} onClick={onUseCurrentLocation}>
        {locating ? <LoaderCircle size={15} className="address-spinner" /> : <Navigation size={15} />}
        <span><strong>{locating ? 'Getting your location...' : 'Use my current location'}</strong><small>Use this device's current position as the origin</small></span>
      </button>}
      {searchError ? <div className="address-empty" role="status">{searchError}</div> : isLoading && suggestions.length === 0 ? <div className="address-empty">{isFullAddressSearch ? 'Searching the full address across providers...' : 'Searching places...'}</div> : suggestions.length ? suggestions.map((place, index) => {
        const key = place.id || place.label || `${place.lat}-${place.lon}-${index}`
        return <button type="button" role="option" aria-selected="false" className="address-suggestion" key={key} disabled={Boolean(resolvingId)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place)}>
          {resolvingId === key ? <LoaderCircle size={15} className="address-spinner" /> : <MapPin size={15} />}
          <span><strong>{place.title || place.label}</strong><small>{[place.subtitle, place.type, place.country].filter(Boolean).join(' · ')}</small></span>
        </button>
      }) : value.trim().length < 2 ? <div className="address-empty">Type 2 or more characters to search places.</div> : value.trim().length < 6 ? <div className="address-empty">Keep typing; full-address search starts after 6 characters.</div> : <div className="address-empty">No match yet. Try adding the area or sector, road, city, province, and country (for example, Pakistan), or use a nearby landmark.</div>}
    </div>}
  </div>
}
