const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure binary assets like PNG and JPG stay in assetExts so Metro doesn't try to parse them as code
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'png', 'jpg', 'jpeg']));
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => !['png', 'jpg', 'jpeg'].includes(ext));

module.exports = config;
