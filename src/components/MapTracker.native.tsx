import React, { useEffect, useMemo, useRef } from 'react';
import MapView, { Marker, Polyline, Region, UrlTile } from 'react-native-maps';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BookingStatus } from '../types';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Props = {
  client: Coordinate;
  photographer: Coordinate;
  status: BookingStatus;
};

export const MapTracker: React.FC<Props> = ({ client, photographer, status }) => {
  const { width } = useWindowDimensions();
  const mapRef = useRef<any | null>(null);
  const region: Region = useMemo(
    () => ({
      latitude: (client.latitude + photographer.latitude) / 2,
      longitude: (client.longitude + photographer.longitude) / 2,
      latitudeDelta: Math.abs(client.latitude - photographer.latitude) + 2,
      longitudeDelta: Math.abs(client.longitude - photographer.longitude) + 2,
    }),
    [client.latitude, client.longitude, photographer.latitude, photographer.longitude]
  );

  useEffect(() => {
    if (!mapRef.current) return;
    try {
      (mapRef.current as any).fitToCoordinates([client, photographer], {
        edgePadding: { top: 60, bottom: 60, left: 40, right: 40 },
        animated: true,
      });
    } catch (e) {
      // ignore
    }
  }, [client, photographer]);

  return (
    <View style={[styles.container, { height: Math.min(440, width < 480 ? 280 : 360) }]}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={region}>
        <UrlTile urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
        <Marker coordinate={photographer} title="Photographer" description="Live location" pinColor="#0f172a" />
        <Marker coordinate={client} title="You" description={`Booking status: ${status}`} pinColor="#2563eb" />
        <Polyline
          coordinates={[client, photographer]}
          strokeColor="#0f172a"
          strokeWidth={4}
          lineCap="round"
          lineJoin="round"
        />
      </MapView>
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
});
