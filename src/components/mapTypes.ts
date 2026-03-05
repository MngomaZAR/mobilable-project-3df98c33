export type MapMarkerType = 'user' | 'photographer';

export type MapMarker = {
  id: string;
  title: string;
  description?: string;
  latitude: number;
  longitude: number;
  type: MapMarkerType;
};

export type MapPreviewProps = {
  markers: MapMarker[];
  onMapError?: (message: string) => void;
};
