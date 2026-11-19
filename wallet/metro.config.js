// Expo's defaults, plus a stand-in for Node's "crypto" (see shims/crypto.js).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const crypto = path.resolve(__dirname, 'shims/crypto.js');
const resolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (name === 'crypto' && platform !== 'web') return { type: 'sourceFile', filePath: crypto };
  return (resolve ?? ctx.resolveRequest)(ctx, name, platform);
};

module.exports = config;
