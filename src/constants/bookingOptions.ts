export const SERVICE_TYPES = [
  { id: 'paparazzi', label: 'Paparazzi', detail: 'On-demand coverage' },
  { id: 'event', label: 'Event', detail: 'Weddings, parties, launches' },
  { id: 'photoshoot', label: 'Photoshoot', detail: 'Studio or outdoor session' },
  { id: 'video', label: 'Video', detail: 'Video shoot or reels' },
];

export const TIER_OPTIONS = [
  { id: 'essential', label: 'Essential', basePrice: 1400, summary: 'UberX' },
  { id: 'standard', label: 'Standard', basePrice: 2200, summary: 'Comfort' },
  { id: 'professional', label: 'Professional', basePrice: 3400, summary: 'Business' },
  { id: 'premium', label: 'Premium', basePrice: 5200, summary: 'Uber Black' },
  { id: 'studio', label: 'Studio', basePrice: 8200, summary: 'Production' },
];

export const CAMERA_OPTIONS = [
  { id: 'mirrorless', label: 'Mirrorless body', price: 250 },
  { id: 'dslr', label: 'DSLR body', price: 200 },
  { id: 'cinema', label: 'Cinema body', price: 500 },
];

export const LENS_OPTIONS = [
  { id: 'prime', label: 'Prime lens kit', price: 200 },
  { id: 'zoom', label: 'Zoom lens kit', price: 180 },
  { id: 'telephoto', label: 'Telephoto lens', price: 250 },
];

export const LIGHTING_OPTIONS = [
  { id: 'strobes', label: 'Strobes', price: 280 },
  { id: 'continuous', label: 'Continuous lighting', price: 240 },
  { id: 'reflectors', label: 'Reflectors', price: 120 },
];

export const EXTRA_OPTIONS = [
  { id: 'drone', label: 'Drone add-on', price: 450 },
  { id: 'audio', label: 'Audio kit', price: 200 },
  { id: 'makeup', label: 'Make-up artist', price: 800 },
];
