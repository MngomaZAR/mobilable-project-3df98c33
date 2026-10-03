import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as maplibre from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap, Marker as LibreMarker } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapMarker, MapPreviewProps } from './mapTypes';
import { Coordinates, DEFAULT_CAPE_TOWN_COORDINATES, haversineDistanceKm, validateSouthAfricanLocation } from '../utils/geo';
import { RouteResponse, routingService } from '../services/routingService';

export type WebMapPreviewProps = MapPreviewProps & {
  onMapPress?: (coordinate: Coordinates) => void;
  // Geometry from a road router, in [longitude, latitude] order.
  routeCoordinates?: [number, number][];
  routeSource?: RouteResponse['source'];
};

type RoadRoute = {
  key: string;
  coordinates: [number, number][];
  message: string;
  status: 'loading' | 'ready' | 'unavailable';
};

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ROUTE_SOURCE = 'papzii-road-route';
const ROUTE_UNAVAILABLE = 'Road routing unavailable. Navigation and ETA are unavailable.';
const EMPTY_ROUTE: [number, number][] = [];
const MAX_ROUTE_SNAP_KM = 1;
const isCoordinate = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) && Number.isFinite(longitude) &&
  validateSouthAfricanLocation(latitude, longitude);
const isRoadGeometry = (coordinates: [number, number][]) =>
  coordinates.length >= 2 && coordinates.every((point) =>
    Array.isArray(point) && point.length >= 2 && isCoordinate(point[1], point[0]));

function fitMap(map: LibreMap, markers: MapMarker[], route: [number, number][]) {
  const points: [number, number][] = markers.map((marker) => [marker.longitude, marker.latitude]);
  for (const coordinate of route) points.push(coordinate);
  if (!points.length) return;
  const first = points[0];
  const bounds: [[number, number], [number, number]] = [[...first], [...first]];
  for (const [longitude, latitude] of points) {
    bounds[0][0] = Math.min(bounds[0][0], longitude);
    bounds[0][1] = Math.min(bounds[0][1], latitude);
    bounds[1][0] = Math.max(bounds[1][0], longitude);
    bounds[1][1] = Math.max(bounds[1][1], latitude);
  }
  const { clientWidth, clientHeight } = map.getContainer();
  map.fitBounds(bounds, {
    padding: { top: 60, right: Math.min(72, clientWidth / 4), bottom: Math.min(130, clientHeight / 3), left: Math.min(48, clientWidth / 4) },
    maxZoom: 14,
    duration: 0,
  });
}

export const MapPreview: React.FC<WebMapPreviewProps> = ({
  markers, onMapError, onMarkerPress, onMapPress, routeCoordinates, routeSource,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const pinRefs = useRef<LibreMarker[]>([]);
  const callbacks = useRef({ onMapError, onMarkerPress, onMapPress });
  const fitRef = useRef<() => void>(() => {});
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const [located, setLocated] = useState<Coordinates | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);

  useEffect(() => { callbacks.current = { onMapError, onMarkerPress, onMapPress }; }, [onMapError, onMarkerPress, onMapPress]);

  const validMarkers = useMemo(() => {
    const valid = markers.filter((marker) => isCoordinate(marker.latitude, marker.longitude));
    if (located && !valid.some((marker) => marker.type === 'user')) {
      valid.push({ ...located, id: 'papzii-web-location', title: 'You', type: 'user' });
    }
    return valid;
  }, [markers, located]);
  const selected = validMarkers.find((marker) => marker.id === selectedId);
  const user = validMarkers.find((marker) => marker.type === 'user');
  const startLatitude = user?.latitude;
  const startLongitude = user?.longitude;
  const endLatitude = selected?.latitude;
  const endLongitude = selected?.longitude;
  const destinationId = selected && selected.type !== 'user' ? selected.id : null;
  const routeKey = destinationId ? `${startLatitude},${startLongitude}:${destinationId}:${endLatitude},${endLongitude}` : '';
  const internalRoute = roadRoute?.key === routeKey ? roadRoute : null;
  const externalRouteValid = routeCoordinates !== undefined && routeSource !== 'fallback' && isRoadGeometry(routeCoordinates);
  const coordinates = routeCoordinates !== undefined
    ? (externalRouteValid ? routeCoordinates : EMPTY_ROUTE)
    : (internalRoute?.coordinates ?? EMPTY_ROUTE);
  const routeStatus = routeCoordinates !== undefined
    ? (externalRouteValid ? 'ready' : 'unavailable')
    : (destinationId ? (internalRoute?.status ?? 'loading') : 'idle');
  const routeMessage = routeCoordinates !== undefined
    ? (externalRouteValid ? 'Road route' : ROUTE_UNAVAILABLE)
    : (destinationId ? (internalRoute?.message ?? 'Finding road route...') : '');
  const markerPositions = JSON.stringify(validMarkers.map(({ id, latitude, longitude }) => [id, latitude, longitude]));
  const routePositions = JSON.stringify(coordinates);

  useEffect(() => {
    if (markers.some((marker) => !isCoordinate(marker.latitude, marker.longitude))) {
      callbacks.current.onMapError?.('Unable to render one or more map pins: invalid coordinates or outside South Africa.');
    }
  }, [markers]);

  useEffect(() => {
    if (routeCoordinates !== undefined || !destinationId || endLatitude === undefined || endLongitude === undefined) return;
    if (startLatitude === undefined || startLongitude === undefined) {
      setRoadRoute({ key: routeKey, coordinates: [], status: 'unavailable', message: 'Your location is needed for road directions.' });
      return;
    }
    let active = true;
    setRoadRoute({ key: routeKey, coordinates: [], status: 'loading', message: 'Finding road route...' });
    const unavailable = () => {
      if (!active) return;
      setRoadRoute({ key: routeKey, coordinates: [], status: 'unavailable', message: ROUTE_UNAVAILABLE });
    };
    void routingService.getRoute(
      { latitude: startLatitude, longitude: startLongitude },
      { latitude: endLatitude, longitude: endLongitude },
    ).then((route) => {
      if (!active) return;
      if (route.source === 'fallback' || !isRoadGeometry(route.coordinates)) { unavailable(); return; }
      const first = route.coordinates[0];
      const last = route.coordinates[route.coordinates.length - 1];
      // Road snapping must still connect the requested locations, not distant roads.
      if (haversineDistanceKm({ latitude: startLatitude, longitude: startLongitude }, { latitude: first[1], longitude: first[0] }) > MAX_ROUTE_SNAP_KM ||
          haversineDistanceKm({ latitude: endLatitude, longitude: endLongitude }, { latitude: last[1], longitude: last[0] }) > MAX_ROUTE_SNAP_KM) {
        unavailable();
        return;
      }
      const distance = Number.isFinite(route.distance) && route.distance > 0 ? `${route.distance.toFixed(1)} km` : '';
      const eta = Number.isFinite(route.duration) && route.duration > 0 ? `ETA ${Math.max(1, Math.round(route.duration / 60))} min` : '';
      setRoadRoute({ key: routeKey, coordinates: route.coordinates, status: 'ready', message: ['Road route', distance, eta].filter(Boolean).join(' | ') });
    }).catch(unavailable);
    return () => { active = false; };
  }, [routeCoordinates, destinationId, routeKey, startLatitude, startLongitude, endLatitude, endLongitude]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let map: LibreMap | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const fail = (message: string, isFatal = false) => {
      if (disposed) return;
      setMapError(message);
      setFatal(isFatal);
      callbacks.current.onMapError?.(message);
    };
    setReady(false);
    setFatal(false);
    setMapError(null);
    try {
      maplibre.setWorkerUrl(new URL('/maplibre/maplibre-gl-worker.mjs', window.location.origin).href);
      map = new maplibre.Map({
        container,
        style: MAP_STYLE,
        center: [DEFAULT_CAPE_TOWN_COORDINATES.longitude, DEFAULT_CAPE_TOWN_COORDINATES.latitude],
        zoom: 10,
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right');
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const geolocate = new maplibre.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 10000 },
        showUserLocation: false,
        fitBoundsOptions: { maxZoom: 14 },
      });
      geolocate.on('geolocate', (event) => {
        if (!isCoordinate(event.coords.latitude, event.coords.longitude)) {
          fail('Currently supporting South African locations only.');
          fitRef.current();
          return;
        }
        setLocated({ latitude: event.coords.latitude, longitude: event.coords.longitude });
        setMapError(null);
      });
      geolocate.on('error', () => fail('Unable to get your location. Check browser location permissions.'));
      map.addControl(geolocate, 'top-right');
      map.getCanvas().setAttribute('aria-label', 'Interactive talent map');
      map.on('moveend', () => {
        if (map) map.getCanvas().dataset.mapBounds = JSON.stringify(map.getBounds().toArray());
      });
      map.on('click', (event) => {
        setSelectedId(null);
        callbacks.current.onMapPress?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });
      map.on('error', () => fail('Map tiles could not be loaded. Check your connection and retry.'));
      map.on('load', () => {
        if (disposed) return;
        clearTimeout(loadingTimer);
        setReady(true);
      });
      loadingTimer = setTimeout(() => fail('Map is taking too long to load. Check your connection and retry.'), 15000);
      resizeObserver = new ResizeObserver(() => {
        if (!map || !map.getContainer().clientWidth || !map.getContainer().clientHeight) return;
        map.resize();
        fitRef.current();
      });
      resizeObserver.observe(container);
    } catch {
      fail('Interactive map unavailable. This browser may not support WebGL2, or map initialization failed.', true);
    }
    return () => {
      disposed = true;
      clearTimeout(loadingTimer);
      resizeObserver?.disconnect();
      pinRefs.current.forEach((pin) => pin.remove());
      pinRefs.current = [];
      fitRef.current = () => {};
      mapRef.current = null;
      map?.remove();
      container.replaceChildren();
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    pinRefs.current.forEach((pin) => pin.remove());
    pinRefs.current = validMarkers.map((marker) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `papzii-map-pin papzii-map-pin-${marker.type === 'user' ? 'user' : marker.type === 'model' ? 'model' : 'photographer'}`;
      const label = [marker.title || (marker.type === 'user' ? 'You' : 'Talent'), marker.description].filter(Boolean).join(', ');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.dataset.markerId = marker.id;
      button.dataset.markerType = marker.type;
      button.dataset.latitude = String(marker.latitude);
      button.dataset.longitude = String(marker.longitude);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setSelectedId(marker.id);
        callbacks.current.onMarkerPress?.(marker);
      });
      return new maplibre.Marker({ element: button, anchor: 'center' })
        .setLngLat([marker.longitude, marker.latitude]).addTo(map);
    });
    return () => { pinRefs.current.forEach((pin) => pin.remove()); pinRefs.current = []; };
  }, [validMarkers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: coordinates.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] : [],
    };
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data });
      map.addLayer({ id: 'papzii-road-route-outline', type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } });
      map.addLayer({ id: 'papzii-road-route-line', type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 4 } });
    }
  }, [ready, coordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    fitRef.current = () => fitMap(map, validMarkers, coordinates);
    fitRef.current();
  }, [ready, markerPositions, routePositions]);

  const retry = () => { setAttempt((value) => value + 1); };
  const invalidPins = markers.length - markers.filter((marker) => isCoordinate(marker.latitude, marker.longitude)).length;
  const talentCount = validMarkers.filter((marker) => marker.type !== 'user').length;

  return (
    <div className="papzii-web-map" role="region" aria-label="Talent map" data-map-state={fatal ? 'error' : ready ? 'ready' : 'loading'} data-route-state={routeStatus} data-route-points={coordinates.length}>
      <style>{MAP_CSS}</style>
      <div ref={containerRef} className="papzii-web-map-canvas" />
      {!fatal && (
        <button className="papzii-map-fit" type="button" aria-label="Fit all map pins and route" title="Fit all map pins and route" disabled={!ready} onClick={() => fitRef.current()}>
          <Ionicons name="scan-outline" size={22} color="#18181b" />
        </button>
      )}
      {mapError && (
        <div className={fatal ? 'papzii-map-fatal' : 'papzii-map-error'} role="alert">
          <span>{mapError}</span>
          <button className="papzii-map-retry" type="button" onClick={retry} aria-label="Retry map" title="Retry map">
            <Ionicons name="refresh-outline" size={20} color="#18181b" />
          </button>
        </div>
      )}
      {!fatal && (
        <div className="papzii-map-status" role="status" aria-live="polite" aria-atomic="true">
          {!ready && !mapError ? 'Loading map...' : selected ? (
            <><strong>{selected.title || 'Talent'}</strong>{selected.description && <span>{selected.description}</span>}{routeMessage && <span>{routeMessage}</span>}</>
          ) : <span>{talentCount ? `${talentCount} talent pin${talentCount === 1 ? '' : 's'}` : 'No talent locations available.'}</span>}
          {invalidPins > 0 && <span>{invalidPins} pin{invalidPins === 1 ? '' : 's'} hidden: location missing or outside South Africa.</span>}
          {!selected && routeMessage && <span>{routeMessage}</span>}
        </div>
      )}
    </div>
  );
};

const MAP_CSS = `
  .papzii-web-map { position: relative; flex: 1; width: 100%; height: 100%; min-height: 280px; min-width: 0; overflow: hidden; background: #f4f4f5; font: 14px/1.4 system-ui, sans-serif; color: #18181b; }
  .papzii-web-map-canvas { position: absolute; inset: 0; }
  .papzii-web-map .maplibregl-ctrl-group button { width: 44px; height: 44px; }
  .papzii-web-map button:focus-visible, .papzii-web-map canvas:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
  .papzii-web-map .papzii-map-pin { width: 32px; height: 32px; padding: 0; border: 3px solid #fff; border-radius: 50%; background: #18181b; box-shadow: 0 2px 6px #0006; cursor: pointer; }
  .papzii-web-map .papzii-map-pin-user { background: #2563eb; width: 24px; height: 24px; }
  .papzii-web-map .papzii-map-pin-model { background: #db2777; }
  .papzii-web-map .papzii-map-pin:hover { border-color: #a3e635; }
  .papzii-map-fit, .papzii-map-retry { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; border: 1px solid #d4d4d8; border-radius: 4px; background: #fff; cursor: pointer; }
  .papzii-map-fit { position: absolute; left: 12px; top: 12px; box-shadow: 0 1px 4px #0002; }
  .papzii-map-fit:disabled { opacity: .5; cursor: default; }
  .papzii-map-status { position: absolute; bottom: 36px; left: 12px; right: 12px; width: max-content; max-width: calc(100% - 24px); max-height: 40%; overflow: auto; box-sizing: border-box; padding: 8px 12px; border-radius: 4px; background: #fffffff2; pointer-events: auto; box-shadow: 0 1px 4px #0002; overflow-wrap: anywhere; }
  .papzii-map-status strong, .papzii-map-status span { display: block; }
  .papzii-map-status span { font-size: 13px; }
  .papzii-map-error { position: absolute; top: 68px; left: 12px; right: 68px; display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 4px; background: #fff; border: 1px solid #e11d48; font-size: 13px; overflow-wrap: anywhere; }
  .papzii-map-fatal { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; text-align: center; background: #f4f4f5; }
`;
