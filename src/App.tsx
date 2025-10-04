import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

import { init, locationManager } from "@telegram-apps/sdk";
import marker2x from "leaflet/dist/images/marker-icon-2x.png?url";
import marker from "leaflet/dist/images/marker-icon.png?url";
import markerShadow from "leaflet/dist/images/marker-shadow.png?url";

const DEFAULT_ZOOM = 16;
const DEFAULT_ACCURACY = 25;
const TELEGRAM_POLL_INTERVAL = 5000;
const GEO_PERMISSION_DENIED = 1;
const GEO_POSITION_UNAVAILABLE = 2;
const GEO_TIMEOUT = 3;

type LocationPreset = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  isCurrent?: boolean;
};

const LOCATION_PRESETS: LocationPreset[] = [
  {
    id: "current",
    label: "- Current location -",
    lat: 0,
    lng: 0,
    isCurrent: true,
  },
  {
    id: "san-francisco",
    label: "San Francisco",
    lat: 37.774929,
    lng: -122.419416,
  },
  { id: "new-york", label: "New York City", lat: 40.712776, lng: -74.005974 },
  { id: "london", label: "London", lat: 51.507351, lng: -0.127758 },
  { id: "tokyo", label: "Tokyo", lat: 35.676422, lng: 139.650109 },
  { id: "paris", label: "Paris", lat: 48.856613, lng: 2.352222 },
  { id: "sydney", label: "Sydney", lat: -33.86882, lng: 151.209296 },
];

L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: markerShadow,
});

type Position = {
  lat: number;
  lng: number;
  accuracy: number;
};

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const centeredRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const modeRef = useRef<"gps" | "simulated">("gps");
  const lastGpsPositionRef = useRef<Position | null>(null);
  const selectedLocationRef = useRef<string>(LOCATION_PRESETS[0].id);
  const locationSourceRef = useRef<"telegram" | "navigator" | "none">("none");

  const [statusMessage, setStatusMessage] = useState("Requesting location…");
  const [position, setPosition] = useState<Position | null>(null);
  const [mode, setMode] = useState<"gps" | "simulated">("gps");
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    LOCATION_PRESETS[0].id
  );
  const [draftLat, setDraftLat] = useState<string>("");
  const [draftLng, setDraftLng] = useState<string>("");

  modeRef.current = mode;
  selectedLocationRef.current = selectedLocationId;

  const parseNumber = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const parsedLat = parseNumber(draftLat);
  const parsedLng = parseNumber(draftLng);
  const isLatValid = parsedLat !== null && parsedLat >= -90 && parsedLat <= 90;
  const isLngValid =
    parsedLng !== null && parsedLng >= -180 && parsedLng <= 180;
  const coordinatesValid = isLatValid && isLngValid;

  const updateMapElements = useCallback(
    (lat: number, lng: number, accuracy: number) => {
      if (!mapRef.current) {
        return;
      }

      const latLng = L.latLng(lat, lng);

      if (!markerRef.current) {
        markerRef.current = L.marker(latLng).addTo(mapRef.current);
      } else {
        markerRef.current.setLatLng(latLng);
      }

      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = L.circle(latLng, {
          radius: accuracy,
          color: "#3b82f6",
          fillColor: "#3b82f6",
          fillOpacity: 0.08,
          weight: 1,
        }).addTo(mapRef.current);
      } else {
        accuracyCircleRef.current.setLatLng(latLng);
        accuracyCircleRef.current.setRadius(accuracy);
      }

      if (!centeredRef.current) {
        mapRef.current.setView(latLng, DEFAULT_ZOOM);
        centeredRef.current = true;
      } else {
        mapRef.current.panTo(latLng);
      }
    },
    []
  );

  const handleLocationSuccess = useCallback(
    (lat: number, lng: number, accuracy?: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }

      const normalizedAccuracy = Math.max(
        Number.isFinite(accuracy) ? Number(accuracy) : DEFAULT_ACCURACY,
        5
      );

      const nextPosition: Position = {
        lat,
        lng,
        accuracy: normalizedAccuracy,
      };

      lastGpsPositionRef.current = nextPosition;

      if (modeRef.current === "gps" && selectedLocationRef.current === "current") {
        setDraftLat(lat.toFixed(6));
        setDraftLng(lng.toFixed(6));
      }

      if (modeRef.current !== "gps") {
        return;
      }

      setPosition(nextPosition);
      setStatusMessage("Tracking your position");
      updateMapElements(lat, lng, normalizedAccuracy);
    },
    [setDraftLat, setDraftLng, setPosition, setStatusMessage, updateMapElements]
  );

  const handleLocationError = useCallback(
    (error: unknown) => {
      if (modeRef.current !== "gps") {
        return;
      }

      const fallbackMessage = lastGpsPositionRef.current
        ? "Using last known location (GPS unavailable)"
        : "Unable to retrieve your location right now.";

      if (error && typeof error === "object") {
        const { name, message } = error as { name?: string; message?: string };

        if (name === "AccessDeniedError") {
          setStatusMessage(
            "Location access denied. Enable location sharing in Telegram."
          );
          return;
        }

        if (name === "NotAvailableError") {
          setStatusMessage("Location tracking is unavailable on this device.");
          return;
        }

        if (name === "ConcurrentCallError") {
          return;
        }

        const code = (error as { code?: number }).code;
        if (typeof code === "number") {
          if (code === GEO_PERMISSION_DENIED) {
            setStatusMessage("Location access denied. Enable GPS to continue.");
            return;
          }

          if (code === GEO_POSITION_UNAVAILABLE || code === GEO_TIMEOUT) {
            setStatusMessage(fallbackMessage);
            return;
          }
        }

        if (message) {
          setStatusMessage(message);
          return;
        }
      }

      setStatusMessage(fallbackMessage);
    },
    [setStatusMessage]
  );

  const applySimulatedPosition = useCallback(
    (lat: number, lng: number, label?: string) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }

      centeredRef.current = false;
      const accuracy = DEFAULT_ACCURACY;
      setPosition({ lat, lng, accuracy });
      setStatusMessage(label ? `Simulating: ${label}` : "Simulating location");
      updateMapElements(lat, lng, accuracy);
    },
    [updateMapElements]
  );

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    let disposeSdk: VoidFunction | undefined;
    try {
      disposeSdk = init();
    } catch (error) {
      // ignore environments where init is not available
    }

    mapRef.current = L.map(mapContainerRef.current, {
      center: [0, 0],
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      maxZoom: 19,
      minZoom: 3,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapRef.current);

    const cleanupCallbacks: Array<() => void> = [];

    const startTelegramTracking = async (): Promise<boolean> => {
      if (!locationManager.isSupported()) {
        return false;
      }

      let mountedByUs = false;

      if (!locationManager.isMounted()) {
        if (!locationManager.mount.isAvailable()) {
          return false;
        }

        try {
          setStatusMessage("Connecting to Telegram location…");
          const mountPromise = locationManager.mount();
          mountedByUs = true;
          await mountPromise;
        } catch (error) {
          handleLocationError(error);
          return false;
        }
      }

      setStatusMessage("Waiting for Telegram location…");

      const controller: {
        stopped: boolean;
        request: { abort?: () => void } | null;
        timerId: ReturnType<typeof setTimeout> | null;
      } = {
        stopped: false,
        request: null,
        timerId: null,
      };

      const stop = () => {
        controller.stopped = true;
        if (controller.timerId !== null) {
          window.clearTimeout(controller.timerId);
        }
        controller.request?.abort?.();
        if (mountedByUs && locationManager.isMounted()) {
          locationManager.unmount();
        }
        locationSourceRef.current = "none";
      };

      const poll = async () => {
        if (controller.stopped) {
          return;
        }

        try {
          const request = locationManager.requestLocation();
          controller.request = request;
          const location = await request;
          controller.request = null;

          if (controller.stopped) {
            return;
          }

          const latitude = Number(location?.latitude);
          const longitude = Number(location?.longitude);
          const accuracy = Number(location?.horizontal_accuracy);

          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            handleLocationSuccess(latitude, longitude, accuracy);
          } else {
            handleLocationError(
              new Error("Invalid location data received from Telegram."),
            );
          }
        } catch (error) {
          controller.request = null;
          if (controller.stopped) {
            return;
          }

          handleLocationError(error);
        } finally {
          if (!controller.stopped) {
            controller.timerId = window.setTimeout(
              poll,
              TELEGRAM_POLL_INTERVAL,
            );
          }
        }
      };

      locationSourceRef.current = "telegram";
      cleanupCallbacks.push(stop);
      poll();

      return true;
    };

    const startNavigatorTracking = (): boolean => {
      if (!navigator.geolocation) {
        return false;
      }

      setStatusMessage("Waiting for GPS signal…");

      const watchId = navigator.geolocation.watchPosition(
        (currentPosition) => {
          const { latitude, longitude, accuracy } = currentPosition.coords;
          handleLocationSuccess(latitude, longitude, accuracy);
        },
        (geoError) => {
          handleLocationError(geoError);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 10000,
        },
      );

      watchIdRef.current = watchId;
      locationSourceRef.current = "navigator";

      cleanupCallbacks.push(() => {
        navigator.geolocation.clearWatch(watchId);
        watchIdRef.current = null;
        locationSourceRef.current = "none";
      });

      return true;
    };

    (async () => {
      const telegramStarted = await startTelegramTracking();
      if (!telegramStarted) {
        const navigatorStarted = startNavigatorTracking();
        if (!navigatorStarted) {
          setStatusMessage("Geolocation is not supported on this device");
        }
      }
    })().catch((error) => {
      handleLocationError(error);
    });

    return () => {
      cleanupCallbacks.splice(0).forEach((cleanup) => {
        cleanup();
      });

      disposeSdk?.();

      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      accuracyCircleRef.current = null;
      centeredRef.current = false;
      watchIdRef.current = null;
      locationSourceRef.current = "none";
    };
  }, [handleLocationError, handleLocationSuccess]);

  const applyGpsPosition = useCallback(
    (incoming: Position | null, fallbackLabel = "Tracking your position") => {
      if (!incoming) {
        return false;
      }

      centeredRef.current = false;
      setPosition(incoming);
      setStatusMessage(fallbackLabel);
      updateMapElements(incoming.lat, incoming.lng, incoming.accuracy);
      return true;
    },
    [updateMapElements]
  );

  const handleModeChange = (nextMode: "gps" | "simulated") => {
    if (mode === nextMode) {
      return;
    }

    modeRef.current = nextMode;

    if (nextMode === "gps") {
      const applied = applyGpsPosition(lastGpsPositionRef.current);

      if (!applied) {
        centeredRef.current = false;
        setPosition(null);
        setStatusMessage(
          locationSourceRef.current === "telegram"
            ? "Waiting for Telegram location…"
            : "Waiting for GPS signal…"
        );
      }
    } else {
      const reference = lastGpsPositionRef.current ?? position;

      if (reference) {
        setDraftLat(reference.lat.toFixed(6));
        setDraftLng(reference.lng.toFixed(6));
      }

      if (selectedLocationId !== "current") {
        setSelectedLocationId("current");
        selectedLocationRef.current = "current";
      }

      setStatusMessage("Simulator ready — edit coordinates or choose a preset");
    }

    setMode(nextMode);
  };

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextId = event.target.value;
    setSelectedLocationId(nextId);
    selectedLocationRef.current = nextId;

    const preset = LOCATION_PRESETS.find((item) => item.id === nextId);
    if (!preset) {
      return;
    }

    if (preset.isCurrent) {
      const reference = lastGpsPositionRef.current ?? position;
      if (reference) {
        setDraftLat(reference.lat.toFixed(6));
        setDraftLng(reference.lng.toFixed(6));
      }

      if (mode === "simulated") {
        setStatusMessage(
          "Simulator ready — edit coordinates or choose a preset"
        );
      }

      return;
    }

    setDraftLat(preset.lat.toFixed(6));
    setDraftLng(preset.lng.toFixed(6));

    if (mode === "simulated") {
      applySimulatedPosition(preset.lat, preset.lng, preset.label);
    }
  };

  const handleManageClick = () => {
    if (!coordinatesValid || parsedLat === null || parsedLng === null) {
      return;
    }

    const presetLabel = LOCATION_PRESETS.find(
      (item) => item.id === selectedLocationId
    )?.label;
    const label =
      selectedLocationId === "current"
        ? "Current location"
        : presetLabel ?? "Custom location";

    applySimulatedPosition(parsedLat, parsedLng, label);
  };

  return (
    <div className="app">
      <div ref={mapContainerRef} className="map-container" />

      <div className="overlay">
        <span className="status-text">{statusMessage}</span>
        {position && (
          <span className="coords">
            {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
          </span>
        )}
        {position && (
          <span className="accuracy">±{Math.round(position.accuracy)} m</span>
        )}
      </div>

      <div className="control-panel">
        <div className="panel-group">
          <span className="panel-label">Mode</span>
          <div className="mode-toggle" role="group" aria-label="Location mode">
            <button
              type="button"
              className={
                mode === "gps" ? "toggle-button active" : "toggle-button"
              }
              onClick={() => handleModeChange("gps")}
            >
              Live GPS
            </button>
            <button
              type="button"
              className={
                mode === "simulated" ? "toggle-button active" : "toggle-button"
              }
              onClick={() => handleModeChange("simulated")}
            >
              Simulator
            </button>
          </div>
        </div>

        <div className="panel-group">
          <label className="panel-label" htmlFor="location-select">
            Location
          </label>
          <select
            id="location-select"
            className="panel-select"
            value={selectedLocationId}
            onChange={handlePresetChange}
            disabled={mode !== "simulated"}
          >
            {LOCATION_PRESETS.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="manage-button"
          disabled={mode !== "simulated" || !coordinatesValid}
          onClick={handleManageClick}
        >
          Manage
        </button>

        <div className="coordinates-grid">
          <div className="coordinate-field">
            <input
              type="text"
              inputMode="decimal"
              className={`coord-input${
                mode === "simulated" && !isLatValid ? " invalid" : ""
              }`}
              value={draftLat}
              onChange={(event) => setDraftLat(event.target.value)}
              disabled={mode !== "simulated"}
            />
            <span className="coord-label">Latitude</span>
          </div>
          <div className="coordinate-field">
            <input
              type="text"
              inputMode="decimal"
              className={`coord-input${
                mode === "simulated" && !isLngValid ? " invalid" : ""
              }`}
              value={draftLng}
              onChange={(event) => setDraftLng(event.target.value)}
              disabled={mode !== "simulated"}
            />
            <span className="coord-label">Longitude</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
