// Adds two things to app.json at build time, so no secret file lives in the repo:
//  - the Expo project id, which phone push needs to get a push token
//  - the Firebase file for Android push, given to the build as the EAS file variable GOOGLE_SERVICES_JSON
// Without that variable the app still builds; it just cannot receive pushes.
module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, eas: { ...config.extra?.eas, projectId: config.extra?.eas?.projectId ?? 'ccd8db59-d85b-4fc4-9023-bae5dd4e4acf' } },
  android: { ...config.android, ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}) },
});
