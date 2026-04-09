import brandConfig from '../constants/brand.json';

export const BRAND = brandConfig;

const toSvgDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const avatarSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111827" />
      <stop offset="100%" stop-color="#312312" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="64" fill="url(#bg)" />
  <circle cx="128" cy="104" r="46" fill="#f7edd8" opacity="0.96" />
  <path d="M56 220c12-42 40-64 72-64s60 22 72 64" fill="#c9a44a" />
  <circle cx="192" cy="194" r="24" fill="#0f172a" stroke="#f3d59a" stroke-width="5" />
  <text x="192" y="202" font-size="24" text-anchor="middle" fill="#f3d59a" font-family="Arial, Helvetica, sans-serif" font-weight="700">P</text>
</svg>`;

const imageSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1f2937" />
      <stop offset="100%" stop-color="#4b3418" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f3d59a" stop-opacity="0.15" />
      <stop offset="50%" stop-color="#c9a44a" stop-opacity="0.6" />
      <stop offset="100%" stop-color="#f3d59a" stop-opacity="0.1" />
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)" />
  <circle cx="1350" cy="140" r="210" fill="#f3d59a" opacity="0.08" />
  <circle cx="250" cy="760" r="260" fill="#c9a44a" opacity="0.08" />
  <rect x="180" y="250" width="1240" height="400" rx="44" fill="none" stroke="url(#glow)" stroke-width="4" />
  <text x="800" y="455" font-size="120" text-anchor="middle" fill="#f7edd8" font-family="Arial, Helvetica, sans-serif" font-weight="700">${BRAND.name}</text>
  <text x="800" y="535" font-size="38" text-anchor="middle" fill="#f3d59a" font-family="Arial, Helvetica, sans-serif">${BRAND.tagline}</text>
</svg>`;

export const PLACEHOLDER_AVATAR = toSvgDataUri(avatarSvg);
export const PLACEHOLDER_IMAGE = toSvgDataUri(imageSvg);
