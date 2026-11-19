// Startup check: bundles the app with the native modules stubbed out and loads it in Node, so a module that
// throws while loading (for example a circular import leaving a value undefined) is caught before an APK is
// built. It found the 12 Nov 2026 crash (watch -> ethvault -> wallet -> watch). Run: npm run check:startup
import { mkdtempSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
const keep = /^(viem|@noble|@scure|ox|abitype)/;
// every name the app imports from a package, read from the source each run (so the stand-ins never fall behind)
const srcFiles = (function walkAll(d) { return readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walkAll(join(d, f)) : [join(d, f)])); })('src').filter((f) => /\.tsx?$/.test(f));
const imported = new Set();
for (const f of srcFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(/import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*'[^./][^']*'/g)) {
    for (const n of m[1].split(',')) {
      const name = n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) imported.add(name);
    }
  }
}
const names = JSON.stringify([...imported]);

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const routes = walk('src/app').filter((f) => f.endsWith('.tsx')).sort();
const dir = mkdtempSync(join(tmpdir(), 'lokyx-startup-'));
const req = createRequire(import.meta.url);
let failed = 0;
async function load(name, imports) {
  const entry = join(dir, `${name}.tsx`);
  const out = join(dir, `${name}.cjs`);
  writeFileSync(entry, imports.map((f) => `import '${join(process.cwd(), f)}';`).join('\n'));
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /^[^./]/ }, (a) => !/^(react|expo|@expo|@react-native|react-native|@expo-google-fonts)/.test(a.path) ? null : { path: a.path, namespace: 'stub' });
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `const N=[...${names},"defineTask","registerTaskAsync","BackgroundTaskResult","scheduleNotificationAsync","setNotificationHandler","getPermissionsAsync","setNotificationChannelAsync","AndroidImportance","preventAutoHideAsync","hideAsync","impactAsync","notificationAsync","ImpactFeedbackStyle","NotificationFeedbackType","getItemAsync","setItemAsync","deleteItemAsync","authenticateAsync","getEnrolledLevelAsync","hasHardwareAsync","isEnrolledAsync","supportedAuthenticationTypesAsync","AuthenticationType","SecurityLevel","setStringAsync","getStringAsync","preventScreenCaptureAsync","allowScreenCaptureAsync","addListener"];const f=function(){};const P=new Proxy(f,{get:(t,k)=>k==='then'?undefined:k==='OS'?'android':k==='prototype'?f.prototype:P,apply:()=>P,construct:()=>({})});module.exports=new Proxy({},{get:(t,k)=>k==='__esModule'?false:P,ownKeys:()=>N,getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true,value:P})});`, loader: 'js' }));
    } }],
  });
  try {
    req(out);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
await load('all', ['src/app/_layout.tsx', ...routes.filter((r) => !r.endsWith('_layout.tsx'))]);
let i = 0;
for (const f of [...routes, 'src/lib/watch.ts', 'src/lib/wallet.ts', 'src/lib/ethvault.ts', 'src/lib/multichain.ts']) await load(`one${i++}`, [f]);
if (failed) process.exit(1);
console.log(`ok: the app and ${routes.length} screens load without throwing`);
