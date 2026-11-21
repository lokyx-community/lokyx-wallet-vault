import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button, Field, IconButton, Press } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { C } from '../ui/theme';
import { Approve, type Ask } from '../ui/Approve';
import { toUrl, PROVIDER_JS, READ_METHODS, NOT_CONNECTED, REJECTED, reply } from '../lib/provider';
import { rpc } from '../lib/rpc';
import { toggleBookmark, useBookmarks } from '../lib/bookmarks';
import { currentAddress, useAccountRef } from '../lib/wallet';
import { evmSites, isConnected, isEvmConnected, useBlockedSites } from '../lib/data';
import { siteRisk, unblockSite, type SiteRisk } from '../lib/risk-lists';
import { BlockedSite } from '../ui/BlockedSite';
import { appsAddress } from '../lib/appswallet';
import { accountIndexFor } from '../lib/appswallet-core';
import { ApproveEvm, type EvmAsk } from '../ui/ApproveEvm';
import { EVM_PROVIDER_JS, evmKind, quantity, toChainId } from '../lib/evm-dapp-core';
import { activeNets, ensureAddresses, ethPass, updateChains, useChainSettings } from '../lib/multichain';
import { ETH_NETS, ethNetChoices } from '../lib/multichain-core';
import { toast } from '../ui/Toast';
import { isAddress as isEthAddress } from 'viem';
import { useChain, useContractsOn } from '../lib/chain';

const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
const originOf = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return u;
  }
};

export default function Browser() {
  const q = useLocalSearchParams<{ url?: string }>();
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const contractsOn = useContractsOn();
  const me = useAccountRef();
  const chain = useChain();
  const [url, setUrl] = useState(q.url ? toUrl(q.url) : 'https://testnet.lokyx.xyz');
  const [nav, setNav] = useState<WebViewNavigation | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [evmAsk, setEvmAsk] = useState<EvmAsk | null>(null);
  const [stopped, setStopped] = useState<{ url: string; why: NonNullable<SiteRisk> } | null>(null);
  useBlockedSites(); // so a change to the block list shows at once
  const evmMethod = useRef(new Map<number, string>());
  const chainCfg = useChainSettings();
  const progress = useSharedValue(0);
  const bar = useAnimatedStyle(() => ({ width: `${progress.value * 100}%`, opacity: progress.value >= 0.999 ? 0 : 1 }));

  // a site on a scam list, or one you blocked, is never opened
  useEffect(() => {
    const why = siteRisk(originOf(url));
    setStopped(why ? { url, why } : null);
  }, [url]);

  const current = nav?.url ?? url;
  const marks = useBookmarks();
  const starred = marks.some((b) => b.url.replace(/\/+$/, '') === current.replace(/\/+$/, ''));
  const secure = current.startsWith('https://');

  // tell the page when the account changes
  useEffect(() => {
    if (me && isConnected(originOf(current), me.address)) web.current?.injectJavaScript(`window.__lokyxEmit && window.__lokyxEmit('accountsChanged', ${JSON.stringify([me.address])}); true;`);
  }, [me, current]);

  // tell Ethereum pages when the network changes
  useEffect(() => {
    web.current?.injectJavaScript(`window.__lokyxEmit && window.__lokyxEmit('evm:chainChanged', '0x${ETH_NETS[chainCfg.ethNet].chainId.toString(16)}'); true;`);
  }, [chainCfg.ethNet]);

  const answer = (id: number, result: unknown, error?: { code: number; message: string }) => web.current?.injectJavaScript(reply(id, result, error));

  // Ethereum websites (window.ethereum): reads go to the network, connecting, sending and signing are asked about.
  const onEvm = async (m: { id: number; method: string; params: unknown }, origin: string, title: string) => {
    const site = { origin, name: title || host(origin) };
    const params = Array.isArray(m.params) ? m.params : [];
    const net = activeNets().eth;
    const chainId = ETH_NETS[net].chainId;
    const refuse = (code: number, message: string) => answer(m.id, null, { code, message });
    try {
      const kind = evmKind(m.method);
      if (siteRisk(origin) && !['chainId', 'netVersion', 'read', 'permissions', 'accounts'].includes(kind)) {
        toast('Blocked a request from a risky site', 'info');
        return refuse(4001, 'LOKYX Wallet blocked this site: it is on a scam list or you blocked it.');
      }
      // the address this site was connected with: the Apps wallet or the main address
      const main = (await ensureAddresses()).eth;
      const entry = evmSites.get().find((x) => x.origin === origin && (x.address.toLowerCase() === main.toLowerCase() || x.address.toLowerCase() === (appsAddress() ?? '').toLowerCase()));
      const me = entry?.address ?? main;
      const index = accountIndexFor(me, appsAddress());
      const connected = !!entry && isEvmConnected(origin, me);
      switch (kind) {
        case 'chainId':
          return answer(m.id, `0x${chainId.toString(16)}`);
        case 'netVersion':
          return answer(m.id, String(chainId));
        case 'read':
          return answer(m.id, await ethPass(net, m.method, params));
        case 'accounts':
          return answer(m.id, connected && !siteRisk(origin) ? [me] : []);
        case 'connect':
          if (connected) return answer(m.id, m.method === 'wallet_requestPermissions' ? [{ parentCapability: 'eth_accounts' }] : [me]);
          evmMethod.current.set(m.id, m.method);
          return setEvmAsk({ kind: 'connect', id: m.id, site });
        case 'permissions':
          return answer(m.id, connected ? [{ parentCapability: 'eth_accounts' }] : []);
        case 'revoke':
          await evmSites.save((l) => l.filter((x) => x.origin !== origin));
          return answer(m.id, null);
        case 'switch': {
          const want = toChainId((params[0] as { chainId?: unknown } | undefined)?.chainId);
          const to = ethNetChoices(chainCfg.allowMainnet).find((n) => ETH_NETS[n].chainId === want);
          if (want == null) return refuse(-32602, 'That network id is not valid');
          if (!to) return refuse(4902, "The wallet doesn't have that network. It has Sepolia, Base Sepolia and Arbitrum Sepolia.");
          if (to !== net) {
            await updateChains({ ethNet: to });
            toast(`Switched to ${ETH_NETS[to].label}`, 'info');
          }
          return answer(m.id, null);
        }
        case 'add':
          return refuse(4200, "The wallet only uses its own networks, so it can't add this one.");
        case 'send': {
          if (!connected) return refuse(4100, 'Connect first with eth_requestAccounts');
          const tx = (params[0] ?? {}) as Record<string, unknown>;
          const value = quantity(tx.value);
          const data = String(tx.data ?? tx.input ?? '0x');
          const to = tx.to == null || tx.to === '' ? null : String(tx.to);
          if (tx.from && String(tx.from).toLowerCase() !== me.toLowerCase()) return refuse(4100, 'That is not the connected account');
          if (tx.chainId != null && toChainId(tx.chainId) !== chainId) return refuse(-32602, `The wallet is on ${ETH_NETS[net].label}, not the network that request is for`);
          if (value == null || !/^0x([0-9a-fA-F]{2})*$/.test(data) || (to != null && !isEthAddress(to))) return refuse(-32602, 'That transaction is not valid');
          return setEvmAsk({ kind: 'send', id: m.id, site, to, value, data, index });
        }
        case 'sign': {
          if (!connected) return refuse(4100, 'Connect first with eth_requestAccounts');
          if (params[1] && String(params[1]).toLowerCase() !== me.toLowerCase()) return refuse(4100, 'That is not the connected account');
          return setEvmAsk({ kind: 'sign', id: m.id, site, message: String(params[0] ?? ''), index });
        }
        case 'typed': {
          if (!connected) return refuse(4100, 'Connect first with eth_requestAccounts');
          if (String(params[0] ?? '').toLowerCase() !== me.toLowerCase()) return refuse(4100, 'That is not the connected account');
          const raw = typeof params[1] === 'string' ? params[1] : JSON.stringify(params[1]);
          let primaryType = '';
          try {
            primaryType = String(JSON.parse(raw).primaryType ?? '');
          } catch {
            /* checked below */
          }
          if (!primaryType) return refuse(-32602, 'That typed data is not valid');
          return setEvmAsk({ kind: 'typed', id: m.id, site, json: raw, primaryType, index });
        }
        default:
          return refuse(4200, m.method === 'eth_sign' ? "The wallet doesn't do eth_sign: it signs data nobody can read first" : `The wallet doesn't do ${m.method}`);
      }
    } catch (err) {
      answer(m.id, null, { code: -32000, message: (err as Error).message });
    }
  };

  const onMessage = async (e: WebViewMessageEvent) => {
    try {
      const x = JSON.parse(e.nativeEvent.data);
      if (x?.lokyx && x.evm) return void onEvm(x, originOf(e.nativeEvent.url), e.nativeEvent.title);
    } catch {
      return;
    }
    if (!contractsOn) return;
    let m: { lokyx?: number; id: number; method: string; params: Record<string, unknown> };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (!m.lokyx) return;
    const origin = originOf(e.nativeEvent.url);
    const site = { origin, name: e.nativeEvent.title || host(origin) };
    const me = currentAddress();
    const connected = isConnected(origin, me);
    try {
      switch (m.method) {
        case 'lyx_requestAccounts':
        case 'connect':
          if (connected) return answer(m.id, [me]);
          return setAsk({ kind: 'connect', id: m.id, site });
        case 'lyx_accounts':
          return answer(m.id, connected ? [me] : []);
        case 'lyx_chainId':
          return answer(m.id, chain.info?.chainId ?? (await rpc<{ chainId: number }>('lyx_chainInfo')).chainId);
        case 'lyx_sendTransaction':
          if (!connected) return answer(m.id, null, NOT_CONNECTED);
          return setAsk({ kind: 'send', id: m.id, site, to: String(m.params.to ?? ''), value: String(m.params.value ?? '0') });
        case 'lyx_callContract':
          if (!connected) return answer(m.id, null, NOT_CONNECTED);
          return setAsk({ kind: 'call', id: m.id, site, to: String(m.params.to ?? ''), method: String(m.params.method ?? ''), args: (m.params.args as unknown[]) ?? [], value: String(m.params.value ?? '0') });
        case 'lyx_signMessage':
          if (!connected) return answer(m.id, null, NOT_CONNECTED);
          return setAsk({ kind: 'sign', id: m.id, site, message: String(m.params.message ?? '') });
        default:
          if (READ_METHODS.has(m.method)) return answer(m.id, await rpc(m.method, m.params));
          return answer(m.id, null, { code: 4200, message: `The wallet doesn't do ${m.method}` });
      }
    } catch (err) {
      answer(m.id, null, { code: -32000, message: (err as Error).message });
    }
  };

  if (Platform.OS === 'web')
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 24, paddingTop: insets.top + 24, gap: 16, justifyContent: 'center' }}>
        <T v="title">Apps open in the phone app</T>
        <T v="sub" dim>The in-wallet browser needs the phone app. You can open this page in a new tab instead.</T>
        <Button title={`Open ${host(url)}`} onPress={() => Linking.openURL(url)} />
        <Button title="Back" kind="plain" onPress={() => router.back()} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
        <IconButton name="close" label="Close" onPress={() => router.back()} size={38} />
        {editing ? (
          <Field
            value={text}
            onChangeText={setText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
            onBlur={() => setEditing(false)}
            onSubmitEditing={() => {
              setUrl(toUrl(text));
              setEditing(false);
            }}
            style={{ flex: 1, height: 44, borderRadius: 22, fontSize: 15 }}
          />
        ) : (
          <Press haptic={false} onPress={() => (setText(current), setEditing(true))} style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: C.fill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 }}>
            <Icon name={secure ? 'lock' : 'info'} size={13} color={secure ? C.soft : C.wait} width={2} />
            <T v="sub" color={C.soft} numberOfLines={1}>{host(current)}</T>
          </Press>
        )}
        <IconButton name="star" label={starred ? 'Remove bookmark' : 'Bookmark this page'} onPress={() => toggleBookmark(current, nav?.title ?? host(current))} size={38} />
        <IconButton name="refresh" label="Reload" onPress={() => web.current?.reload()} size={38} />
      </View>
      {editing && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
          {marks.map((b) => (
            <Press key={b.url} onPress={() => (setUrl(b.url), setEditing(false))} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: C.fill2, justifyContent: 'center' }}>
              <T v="sub">{b.title}</T>
            </Press>
          ))}
        </View>
      )}
      <View style={{ height: 2, backgroundColor: 'transparent' }}>
        <Animated.View style={[{ height: 2, backgroundColor: C.text }, bar]} />
      </View>
      {stopped ? (
        <BlockedSite
          host={host(stopped.url)}
          why={stopped.why}
          onBack={() => (stopped.url === url ? router.back() : setStopped(null))}
          onUnblock={() => void unblockSite(stopped.url).then(() => setStopped(null))}
        />
      ) : (
        <WebView
          ref={web}
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: C.bg }}
          // window.lokyx is for LOKYX contracts; window.ethereum (and EIP-6963) is for Ethereum websites on the wallet's own networks.
          injectedJavaScriptBeforeContentLoaded={`${contractsOn ? PROVIDER_JS : ''}\n${EVM_PROVIDER_JS}`}
          onMessage={onMessage}
          onNavigationStateChange={setNav}
          onLoadProgress={(e) => (progress.value = withTiming(e.nativeEvent.progress, { duration: 150 }))}
          onLoadStart={() => (progress.value = 0.05)}
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          forceDarkOn
          originWhitelist={['https://*', 'http://*']}
          onShouldStartLoadWithRequest={(r) => {
            const why = siteRisk(originOf(r.url));
            if (why && (r as { isTopFrame?: boolean }).isTopFrame !== false) {
              setStopped({ url: r.url, why });
              return false;
            }
            return true;
          }}
        />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 8, paddingBottom: insets.bottom + 6, borderTopWidth: 0.5, borderColor: C.line }}>
        <Press onPress={() => web.current?.goBack()} disabled={!nav?.canGoBack} accessibilityLabel="Back" style={{ padding: 10 }}>
          <Icon name="back" size={22} color={C.text} />
        </Press>
        <Press onPress={() => web.current?.goForward()} disabled={!nav?.canGoForward} accessibilityLabel="Forward" style={{ padding: 10 }}>
          <Icon name="forward" size={22} color={C.text} />
        </Press>
        <Press onPress={() => Linking.openURL(current)} accessibilityLabel="Open in your browser" style={{ padding: 10 }}>
          <Icon name="share" size={22} color={C.text} />
        </Press>
      </View>

      <ApproveEvm
        ask={evmAsk}
        onDone={(id, result, error) => {
          const was = evmMethod.current.get(id);
          evmMethod.current.delete(id);
          answer(id, was === 'wallet_requestPermissions' && !error ? [{ parentCapability: 'eth_accounts' }] : result, error);
          setEvmAsk(null);
        }}
        rejected={REJECTED}
      />
      <Approve
        ask={ask}
        onDone={(id, result, error) => {
          answer(id, result, error);
          setAsk(null);
        }}
        rejected={REJECTED}
      />
    </View>
  );
}
