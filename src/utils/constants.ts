import brandConfig from '../constants/brand.json';
import { AVATAR_PNG_DATA_URI, IMAGE_PNG_DATA_URI } from './placeholderAssets';

export const BRAND = brandConfig;

// PNG (not SVG): React Native's <Image> renders SVG data URIs as blank on iOS and Android.
export const PLACEHOLDER_AVATAR = AVATAR_PNG_DATA_URI;
export const PLACEHOLDER_IMAGE = IMAGE_PNG_DATA_URI;
