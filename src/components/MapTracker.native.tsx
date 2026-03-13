import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BookingStatus } from '../types';

MapLibreGL.setTelemetryEnabled(false);

const MAP_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Props = {
  client: Coordinate;
  photographer: Coordinate;
  status: BookingStatus;
};

const getZoomLevel = (latDelta: number, lngDelta: number) => {
  const maxDelta = Math.max(latDelta, lngDelta);
  if (maxDelta > 20) return 3;
  if (maxDelta > 10) return 4;
  if (maxDelta > 6) return 5;
  if (maxDelta > 3) return 6;
  if (maxDelta > 2) return 7;
  if (maxDelta > 1) return 8;
  if (maxDelta > 0.6) return 10;
  if (maxDelta > 0.3) return 11;
  return 12;
};

export const MapTracker: React.FC<Props> = ({ client, photographer, status }) => {
  const { width } = useWindowDimensions();

  const { center, zoomLevel, lineGeoJson } = useMemo(() => {
    const minLat = Math.min(client.latitude, photographer.latitude);
    const maxLat = Math.max(client.latitude, photographer.latitude);
    const minLng = Math.min(client.longitude, photographer.longitude);
    const maxLng = Math.max(client.longitude, photographer.longitude);

    const latDelta = Math.max(0.01, maxLat - minLat);
    const lngDelta = Math.max(0.01, maxLng - minLng);

    return {
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [number, number],
      zoomLevel: getZoomLevel(latDelta, lngDelta),
      lineGeoJson: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [client.longitude, client.latitude],
                [photographer.longitude, photographer.latitude],
              ],
            },
            properties: { status },
          },
        ],
      },
    };
  }, [client.latitude, client.longitude, photographer.latitude, photographer.longitude, status]);

  return (
    <View style={[styles.container, { height: Math.min(440, width < 480 ? 280 : 360) }]}>
      <MapLibreGL.MapView style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE_URL}>
        <MapLibreGL.Camera centerCoordinate={center} zoomLevel={zoomLevel} animationDuration={600} />
        <MapLibreGL.ShapeSource id="tracker-line" shape={lineGeoJson as any}>
          <MapLibreGL.LineLayer
            id="tracker-line-layer"
            style={{
              lineColor: '#0f172a',
              lineWidth: 4,
              lineJoin: 'round',
              lineCap: 'round',
            }}
          />
        </MapLibreGL.ShapeSource>
        <MapLibreGL.PointAnnotation
          id="tracker-photographer"
          coordinate={[photographer.longitude, photographer.latitude]}
        >
          <View style={[styles.pin, styles.photographerPin]} />
        </MapLibreGL.PointAnnotation>
        <MapLibreGL.PointAnnotation id="tracker-client" coordinate={[client.longitude, client.latitude]}>
          <View style={[styles.pin, styles.clientPin]} />
        </MapLibreGL.PointAnnotation>
      </MapLibreGL.MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    minHeight: 260,
  },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  photographerPin: {
    backgroundColor: '#0f172a',
  },
  clientPin: {
    backgroundColor: '#2563eb',
  },
});

