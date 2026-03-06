import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

export const MapTracker: React.FC<Props> = ({ client, photographer, status }) => (
  <View style={styles.container}>
    <Text style={styles.title}>Live map is available on iOS/Android</Text>
    <Text style={styles.subtitle}>Web preview shows coordinates and status for transparency.</Text>
    <View style={styles.row}>
      <Text style={styles.label}>Booking status</Text>
      <Text style={styles.value}>{status}</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.label}>You</Text>
      <Text style={styles.value}>
        {client.latitude.toFixed(2)}, {client.longitude.toFixed(2)}
      </Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.label}>Photographer</Text>
      <Text style={styles.value}>
        {photographer.latitude.toFixed(2)}, {photographer.longitude.toFixed(2)}
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#f9fafb',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  label: {
    color: '#475569',
    fontWeight: '600',
  },
  value: {
    color: '#0f172a',
    fontWeight: '700',
  },
});

