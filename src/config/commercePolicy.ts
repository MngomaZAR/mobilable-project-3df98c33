import { Platform } from 'react-native';

export type StoreTarget = 'development' | 'web' | 'internal' | 'appstore' | 'play' | 'both';
export type DigitalBillingProvider = 'iap' | 'external' | 'disabled';

const normalize = (value: string | undefined, fallback: string) => (value ?? fallback).trim().toLowerCase();
const isTruthy = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());

const asStoreTarget = (value: string): StoreTarget => {
  const allowed: StoreTarget[] = ['development', 'web', 'internal', 'appstore', 'play', 'both'];
  return allowed.includes(value as StoreTarget) ? (value as StoreTarget) : 'development';
};

const asDigitalBillingProvider = (value: string): DigitalBillingProvider => {
  const allowed: DigitalBillingProvider[] = ['iap', 'external', 'disabled'];
  return allowed.includes(value as DigitalBillingProvider) ? (value as DigitalBillingProvider) : 'external';
};

const envStoreTarget = asStoreTarget(normalize(process.env.EXPO_PUBLIC_STORE_TARGET, 'development'));
const envBillingProvider = asDigitalBillingProvider(
  normalize(process.env.EXPO_PUBLIC_DIGITAL_BILLING_PROVIDER, 'external')
);
const envDisableDigitalPurchases = isTruthy(process.env.EXPO_PUBLIC_DISABLE_DIGITAL_PURCHASES);

export const commercePolicy = {
  storeTarget: envStoreTarget,
  digitalBillingProvider: envBillingProvider,
  disableDigitalPurchases: envDisableDigitalPurchases,
};

const isCurrentPlatformStoreTarget = () => {
  if (Platform.OS === 'ios') {
    return commercePolicy.storeTarget === 'appstore' || commercePolicy.storeTarget === 'both';
  }

  if (Platform.OS === 'android') {
    return commercePolicy.storeTarget === 'play' || commercePolicy.storeTarget === 'both';
  }

  return false;
};

export const areDigitalPurchasesAllowed = () => {
  if (commercePolicy.disableDigitalPurchases) return false;
  if (commercePolicy.digitalBillingProvider === 'disabled') return false;
  if (!isCurrentPlatformStoreTarget()) return true;
  return commercePolicy.digitalBillingProvider === 'iap';
};

export const getDigitalPurchaseRestrictionMessage = () => {
  if (commercePolicy.disableDigitalPurchases) {
    return 'Digital purchases are temporarily disabled for this release.';
  }

  if (isCurrentPlatformStoreTarget() && commercePolicy.digitalBillingProvider !== 'iap') {
    return 'This build requires in-app billing for digital purchases.';
  }

  return 'Digital purchases are unavailable in this build.';
};

export const assertDigitalPurchasesAllowed = () => {
  if (!areDigitalPurchasesAllowed()) {
    throw new Error(getDigitalPurchaseRestrictionMessage());
  }
};

export const getSupabaseBaseUrl = () => {
  const value = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

export const getDefaultPayfastNotifyUrl = () => {
  const base = getSupabaseBaseUrl();
  if (!base) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL for payment notify URL.');
  }
  return `${base}/functions/v1/payfast-handler/notify`;
};
