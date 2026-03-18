import { Platform } from 'react-native';
import { MapTracker as WebMapTracker } from './MapTracker.web';
import { MapTracker as NativeMapTracker } from './MapTracker.native';

export const MapTracker = Platform.OS === 'web' ? WebMapTracker : NativeMapTracker;
