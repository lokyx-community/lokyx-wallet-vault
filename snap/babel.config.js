// Used only by Jest, to run the tests and to turn ESM-only dependencies into CommonJS.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
    ['@babel/preset-react', { runtime: 'automatic', importSource: '@metamask/snaps-sdk' }],
  ],
};
