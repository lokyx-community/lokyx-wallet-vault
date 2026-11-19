// Lets the Live alerts service run as a foreground service of the "special use" kind (Android 14 and newer
// refuse a foreground service without a declared type). Nothing else in the manifest changes.
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m.$['xmlns:tools'] = m.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const perms = m['uses-permission'] || (m['uses-permission'] = []);
    for (const p of ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE']) {
      if (!perms.some((x) => x.$['android:name'] === p)) perms.push({ $: { 'android:name': p } });
    }
    const app = m.application[0];
    const services = app.service || (app.service = []);
    const name = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let svc = services.find((s) => s.$['android:name'] === name);
    if (!svc) services.push((svc = { $: { 'android:name': name } }));
    svc.$['android:foregroundServiceType'] = 'specialUse';
    svc.$['android:exported'] = 'false';
    svc.property = [{ $: { 'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE', 'android:value': 'Watches the wallet for payments and vault withdrawals and tells the owner at once' } }];
    return c;
  });
