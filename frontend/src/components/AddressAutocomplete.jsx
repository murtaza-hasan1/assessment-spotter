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
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    setActiveIndex(-1)
  }, [suggestions, value])

  useEffect(() => {
    if (activeIndex >= 0) {
      const list = document.getElementById(listId + '-suggestions')
      const activeEl = list?.querySelector(`[data-index="${activeIndex}"]`)
      activeEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, listId])

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
          const hasCurrentLoc = Boolean(onUseCurrentLocation)
          const totalItems = (hasCurrentLoc ? 1 : 0) + suggestions.length

          if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            if (totalItems > 0 || value.trim().length >= 2) {
              setIsOpen(true)
            }
          }

          if (event.key === 'ArrowDown') {
            if (totalItems > 0) {
              event.preventDefault()
              setActiveIndex((prev) => (prev + 1) % totalItems)
            }
          } else if (event.key === 'ArrowUp') {
            if (totalItems > 0) {
              event.preventDefault()
              setActiveIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1))
            }
          } else if (event.key === 'Enter') {
            if (isOpen && activeIndex >= 0) {
              event.preventDefault()
              if (hasCurrentLoc && activeIndex === 0) {
                onUseCurrentLocation()
              } else {
                const placeIdx = hasCurrentLoc ? activeIndex - 1 : activeIndex
                if (suggestions[placeIdx]) {
                  choose(suggestions[placeIdx])
                }
              }
            }
          } else if (event.key === 'Escape') {
            setIsOpen(false)
            setActiveIndex(-1)
          }
        }}
      />
      {isLoading && <LoaderCircle size={15} className="address-spinner" aria-label="Searching places" />}
    </div>
    {selectedPlace && <span className="address-status" id={listId + '-status'}>{selectedPlace.isCurrentLocation ? 'Current device location' : `Selected ${selectedPlace.country || 'location'}`}</span>}
    {isOpen && !selectedPlace && <div className="address-suggestions" id={listId + '-suggestions'} role="listbox" aria-label={`${label.toLowerCase()} suggestions`}>
      {onUseCurrentLocation && <button
        type="button"
        role="option"
        aria-selected={activeIndex === 0}
        data-index="0"
        className={`address-suggestion current-location-option ${activeIndex === 0 ? 'is-active' : ''}`}
        disabled={locating}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(0)}
        onClick={onUseCurrentLocation}
      >
        {locating ? <LoaderCircle size={15} className="address-spinner" /> : <Navigation size={15} />}
        <span><strong>{locating ? 'Getting your location...' : 'Use my current location'}</strong><small>Use this device's current position as the origin</small></span>
      </button>}
      {searchError ? <div className="address-empty" role="status">{searchError}</div> : isLoading && suggestions.length === 0 ? <div className="address-empty">{isFullAddressSearch ? 'Searching the full address across providers...' : 'Searching places...'}</div> : suggestions.length ? suggestions.map((place, index) => {
        const itemIdx = (onUseCurrentLocation ? 1 : 0) + index
        const key = place.id || place.label || `${place.lat}-${place.lon}-${index}`
        const isActive = activeIndex === itemIdx
        return <button
          type="button"
          role="option"
          aria-selected={isActive}
          data-index={itemIdx}
          className={`address-suggestion ${isActive ? 'is-active' : ''}`}
          key={key}
          disabled={Boolean(resolvingId)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(itemIdx)}
          onClick={() => choose(place)}
        >
          {resolvingId === key ? <LoaderCircle size={15} className="address-spinner" /> : <MapPin size={15} />}
          <span><strong>{place.title || place.label}</strong><small>{[place.subtitle, place.type, place.country].filter(Boolean).join(' · ')}</small></span>
        </button>
      }) : value.trim().length < 2 ? <div className="address-empty">Type 2 or more characters to search places.</div> : value.trim().length < 6 ? <div className="address-empty">Keep typing; full-address search starts after 6 characters.</div> : <div className="address-empty">No match yet. Try adding the area or sector, road, city, province, and country (for example, Pakistan), or use a nearby landmark.</div>}
    </div>}
  </div>
}
