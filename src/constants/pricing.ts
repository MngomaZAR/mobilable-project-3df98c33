export type PricingPackage = {
  id: string;
  label: string;
  duration: string;
  basePrice: number;
  description: string;
  highlights: string[];
};

export const BOOKING_PACKAGES: PricingPackage[] = [
  {
    id: 'instant',
    label: 'Instant Request',
    duration: '30–45 min',
    basePrice: 1500,
    description: 'Fast shoot, quick delivery.',
    highlights: ['On‑demand', '1–2 looks', 'Same‑day option'],
  },
  {
    id: 'starter',
    label: 'Starter Session',
    duration: '1–2 hours',
    basePrice: 2200,
    description: 'Best for quick portraits.',
    highlights: ['3–4 looks', 'Basic retouch', '48h delivery'],
  },
  {
    id: 'standard',
    label: 'Standard Shoot',
    duration: '3–4 hours',
    basePrice: 3600,
    description: 'Balanced coverage + retouching.',
    highlights: ['5–8 looks', 'Pro retouch', '72h delivery'],
  },
  {
    id: 'full',
    label: 'Full‑Day Coverage',
    duration: '6–8 hours',
    basePrice: 6000,
    description: 'Events & long sessions.',
    highlights: ['10+ looks', 'Priority edits', '3–5 day delivery'],
  },
  {
    id: 'premium',
    label: 'Premium Experience',
    duration: '8–10 hours',
    basePrice: 9000,
    description: 'High‑touch production.',
    highlights: ['Creative direction', 'Rush edits', 'Priority support'],
  },
];
