import { CommissionBreakdown, EventPackage, Photographer, PRICING_CONFIG, PricingMode, PricingQuote } from '../types';

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const ratingTier = (rating: number) => {
  if (rating >= 4.8) return PRICING_CONFIG.paparazzi.ratingMultiplier.elite;
  if (rating >= 4.4) return PRICING_CONFIG.paparazzi.ratingMultiplier.high;
  if (rating >= 4.0) return PRICING_CONFIG.paparazzi.ratingMultiplier.mid;
  return PRICING_CONFIG.paparazzi.ratingMultiplier.low;
};

export const commissionBreakdown = (gross: number): CommissionBreakdown => {
  const rate = PRICING_CONFIG.commissionRate;
  const commissionAmount = roundMoney(gross * rate);
  const photographerPayout = roundMoney(gross - commissionAmount);
  return {
    gross: roundMoney(gross),
    commissionRate: rate,
    commissionAmount,
    photographerPayout,
  };
};

export const quotePaparazziSession = (
  photographer: Photographer,
  distanceKm: number,
  numPhotos: number,
  currency = PRICING_CONFIG.currency
): PricingQuote => {
  const basePrice = PRICING_CONFIG.paparazzi.basePerPhoto * Math.max(1, numPhotos);
  const distanceFee = PRICING_CONFIG.paparazzi.distanceFeePerKm * Math.max(0, distanceKm);
  const multiplier = ratingTier(photographer.rating);
  const subtotal = roundMoney((basePrice + distanceFee) * multiplier);
  const commission = commissionBreakdown(subtotal);

  return {
    mode: 'paparazzi',
    photographerId: photographer.id,
    distanceKm,
    rating: photographer.rating,
    basePrice,
    distanceFee,
    ratingMultiplier: multiplier,
    subtotal,
    commission,
    total: commission.gross,
    currency,
    metadata: {
      numPhotos,
    },
  };
};

export const quoteEventPackage = (
  photographer: Photographer,
  packageType: EventPackage,
  distanceKm: number,
  currency = PRICING_CONFIG.currency
): PricingQuote => {
  const basePrice = packageType.basePrice;
  const distanceFee = PRICING_CONFIG.paparazzi.distanceFeePerKm * Math.max(0, distanceKm);
  const multiplier = ratingTier(photographer.rating);
  const subtotal = roundMoney((basePrice + distanceFee) * multiplier);
  const commission = commissionBreakdown(subtotal);

  return {
    mode: 'event',
    photographerId: photographer.id,
    distanceKm,
    rating: photographer.rating,
    basePrice,
    distanceFee,
    ratingMultiplier: multiplier,
    subtotal,
    commission,
    total: commission.gross,
    currency,
    metadata: {
      packageId: packageType.id,
      durationHours: packageType.durationHours,
    },
  };
};

export const getEventPackages = (): EventPackage[] => PRICING_CONFIG.eventPackages;

export const formatPricingLabel = (quote: PricingQuote) => {
  const suffix = quote.mode === 'paparazzi' ? 'per session' : 'per event';
  return `${quote.currency} ${quote.total.toFixed(2)} ${suffix}`;
};

export const parsePricingMode = (value: string): PricingMode => (value === 'event' ? 'event' : 'paparazzi');
