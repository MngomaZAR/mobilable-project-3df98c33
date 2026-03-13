export type MapMarker = {
  id: string;
  sourceId?: string;
  latitude: number;
  longitude: number;
  type: 'user' | 'photographer' | string;
  title?: string;
  description?: string;
};

export type MapPreviewProps = {
  markers: MapMarker[];
  onMapError?: (message: string) => void;
  onMarkerPress?: (marker: MapMarker) => void;
};
