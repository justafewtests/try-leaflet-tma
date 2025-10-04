import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

import marker2x from 'leaflet/dist/images/marker-icon-2x.png'
import marker from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

const DEFAULT_ZOOM = 16

L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: markerShadow,
})

type Position = {
  lat: number
  lng: number
  accuracy: number
}

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const accuracyCircleRef = useRef<L.Circle | null>(null)
  const centeredRef = useRef(false)
  const watchIdRef = useRef<number | null>(null)

  const [statusMessage, setStatusMessage] = useState('Requesting location…')
  const [position, setPosition] = useState<Position | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) {
      return
    }

    mapRef.current = L.map(mapContainerRef.current, {
      center: [0, 0],
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      maxZoom: 19,
      minZoom: 3,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapRef.current)

    if (!navigator.geolocation) {
      setStatusMessage('Geolocation is not supported on this device')
      return () => {
        mapRef.current?.remove()
        mapRef.current = null
        markerRef.current = null
        accuracyCircleRef.current = null
        centeredRef.current = false
      }
    }

    setStatusMessage('Waiting for GPS signal…')

    watchIdRef.current = navigator.geolocation.watchPosition(
      (currentPosition) => {
        const { latitude, longitude, accuracy } = currentPosition.coords
        const nextPosition = { lat: latitude, lng: longitude, accuracy }
        setPosition(nextPosition)
        setStatusMessage('Tracking your position')

        if (!mapRef.current) {
          return
        }

        const latLng = L.latLng(latitude, longitude)

        if (!markerRef.current) {
          markerRef.current = L.marker(latLng).addTo(mapRef.current)
        } else {
          markerRef.current.setLatLng(latLng)
        }

        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = L.circle(latLng, {
            radius: accuracy,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            weight: 1,
          }).addTo(mapRef.current)
        } else {
          accuracyCircleRef.current.setLatLng(latLng)
          accuracyCircleRef.current.setRadius(accuracy)
        }

        if (!centeredRef.current) {
          mapRef.current.setView(latLng, DEFAULT_ZOOM)
          centeredRef.current = true
        } else {
          mapRef.current.panTo(latLng)
        }
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setStatusMessage('Location access denied. Enable GPS to continue.')
          return
        }

        if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          setStatusMessage('Location information is unavailable right now')
          return
        }

        if (geoError.code === geoError.TIMEOUT) {
          setStatusMessage('Timed out while waiting for GPS. Trying again…')
          return
        }

        setStatusMessage('Unexpected error while retrieving your location')
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }

      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      accuracyCircleRef.current = null
      centeredRef.current = false
      watchIdRef.current = null
    }
  }, [])

  return (
    <div className="app">
      <div ref={mapContainerRef} className="map-container" />

      <div className="overlay">
        <span className="status-text">{statusMessage}</span>
        {position && (
          <span className="coords">{position.lat.toFixed(5)}, {position.lng.toFixed(5)}</span>
        )}
        {position && <span className="accuracy">±{Math.round(position.accuracy)} m</span>}
      </div>
    </div>
  )
}

export default App
