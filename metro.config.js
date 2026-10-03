const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure binary assets like PNG stay in assetExts so Metro doesn't try to parse them as code
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'png']));
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'png');
// Avoid noisy "exports" warnings from nested dependencies (LiveKit event-target-shim)
config.resolver.unstable_enablePackageExports = false;

// MapLibre 6 has an ESM-only entry; keep existing resolution for other packages.
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'mjs']));
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    context,
    moduleName === 'maplibre-gl' ? 'maplibre-gl/dist/maplibre-gl.mjs' : moduleName,
    platform
  );

module.exports = config;
