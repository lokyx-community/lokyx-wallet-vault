module.exports = {
  preset: '@metamask/snaps-jest',
  transform: { '^.+\\.(t|j)sx?$': 'babel-jest', '^.+\\.mjs$': 'babel-jest' },
  transformIgnorePatterns: ['/node_modules/(?!(@metamask|@noble|@scure|@ethereumjs|uuid|nanoid)/)'],
  testTimeout: 60000,
};
