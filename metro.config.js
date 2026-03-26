const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure binary assets like PNG stay in assetExts so Metro doesn't try to parse them as code
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'png']));
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'png');
// Avoid noisy "exports" warnings from nested dependencies (LiveKit event-target-shim)
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
