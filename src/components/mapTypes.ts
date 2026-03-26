export type MapMarker = {
  id: string;
  sourceId?: string;
  latitude: number;
  longitude: number;
  type: 'user' | 'photographer' | 'model' | string;
  title?: string;
  description?: string;
  avatarUrl?: string;
  rating?: number | null;
};

export type MapPreviewProps = {
  markers: MapMarker[];
  onMapError?: (message: string) => void;
  onMarkerPress?: (marker: MapMarker) => void;
};
