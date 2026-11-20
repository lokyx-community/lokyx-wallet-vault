import { useEffect, useRef, useState } from 'react';
import { flyCoin } from '../../ui/CoinFlight';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '../../ui/Icon';
import { parsePayload } from '../../lib/scan-core';
import { router, useLocalSearchParams } from 'expo-router';
import { plainError } from '../../lib/plain-error';
import { T } from '../../ui/Text';
import { Button, ErrorText, Field, Note, Press, Screen, failure, success } from '../../ui/controls';
import { DestGuard } from '../../ui/DestGuard';
import { SendCompose, SendReview } from '../../ui/SendCompose';
import { notePendingFeed } from '../../lib/feed-pending';
import { newDeviceGate } from '../../lib/guard';
import { Segmented } from '../../ui/Segmented';
import { ApproveButton } from '../../ui/ApproveButton';
import { C, F } from '../../ui/theme';
import { confirmIt } from '../../lib/auth';
import {
  activeNets, broadcastBtc, broadcastEth, btcBalance, btcTxBlock, ethBalance, tokenBalance, ensureAddresses, ethTxBlock, knownDestinations, prepareBtc, prepareEth, rememberDestination, tokensFor, useChainSettings,
} from '../../lib/multichain';
import { BTC_NETS, ETH_NETS, KNOWN_TOKENS, btcAddressOk, describeBtc, describeEth, ethAddressOk, formatBtc, formatUnits, parseBtc, parseUnits, tokenId, type Speed } from '../../lib/multichain-core';
import { ChainRing } from '../../ui/ChainRing';
import { CoinLaunch } from '../../ui/CoinLaunch';
import { Slip, shareSlip, useReveal } from '../../ui/Slip';
import { feeFromLines, type SlipInput } from '../../lib/slip-core';
import { nameFor } from '../../lib/format';
import { useCoins } from '../../lib/coins';
import { CoinLogo } from '../../ui/CoinLogo';
import { type FillStage } from '../../lib/sunfill-core';

type Prepared =
  | { kind: 'btc'; lines: string[]; net: ReturnType<typeof activeNets>['btc']; hex: string; txid: string }
  | { kind: 'eth'; lines: string[]; net: ReturnType<typeof activeNets>['eth']; raw: string };

/** Send Bitcoin, Ether or an ERC-20 token. Shows what will happen in words before it can be signed. */
export default function ChainSend() {
  const { chain, token, to: toParam, amount: amtParam, units } = useLocalSearchParams<{ chain: 'btc' | 'eth'; token?: string; to?: string; amount?: string; units?: string }>();
  useChainSettings();
  const nets = activeNets();
  const isBtc = chain === 'btc';
  // a token in the wallet, or one from the token list (a scanned request can name either)
  const chainId = ETH_NETS[nets.eth].chainId;
  const tok = !isBtc && token ? [...tokensFor(nets.eth), ...KNOWN_TOKENS].find((t) => tokenId(t) === tokenId({ chainId, contract: token })) : undefined;
  const unknownToken = !isBtc && !!token && !tok;
  const unit = isBtc ? BTC_NETS[nets.btc].unit : tok ? tok.symbol : ETH_NETS[nets.eth].unit;
  const [to, setTo] = useState(toParam ?? '');
  const [amt, setAmt] = useState(() => {
    if (tok && units && /^\d+$/.test(units)) return formatUnits(BigInt(units), tok.decimals);
    return amtParam && /^\d*\.?\d+$/.test(amtParam) ? amtParam : '';
  });
  const [speed, setSpeed] = useState<Speed>('normal');
  const [known, setKnown] = useState<string[]>([]);
  const [own, setOwn] = useState('');
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<FillStage | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const [txid, setTxid] = useState('');
  const [sentAt, setSentAt] = useState(0);

  useEffect(() => {
    knownDestinations(chain).then(setKnown);
    ensureAddresses().then((a) => setOwn(isBtc ? a.btc[nets.btc] : a.eth)).catch(() => {});
  }, [chain, isBtc, nets.btc]);

  const [held, setHeld] = useState<{ raw: bigint; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    ensureAddresses()
      .then(async (a) => {
        if (isBtc) {
          const b = (await btcBalance(nets.btc, a.btc[nets.btc])).confirmed;
          return { raw: b, text: formatBtc(b) };
        }
        const dec = tok ? tok.decimals : 18;
        const b = tok ? await tokenBalance(nets.eth, tok, a.eth) : await ethBalance(nets.eth, a.eth);
        return { raw: b, text: formatUnits(b, dec, 6) };
      })
      .then((h) => live && setHeld(h))
      .catch(() => {});
    return () => { live = false; };
  }, [chain, isBtc, nets.btc, nets.eth, token]);

  const dest = to.trim();
  const valid = isBtc ? btcAddressOk(dest, nets.btc) : ethAddressOk(dest);
  const [guardOk, setGuardOk] = useState(false);
  const allKnown = [...known, ...(own ? [own] : [])];

  const gateRef = useRef<{ ok: true; commit: () => Promise<void> } | null>(null);
  /** The two-day limit after restoring on a new phone, for this coin. */
  const ndGate = async () => {
    const mine = await ensureAddresses().catch(() => null);
    if (!mine) return { ok: true as const, commit: async () => {} };
    if (isBtc) {
      const value = parseBtc(amt);
      return newDeviceGate(`btc:${nets.btc}`, (await btcBalance(nets.btc, mine.btc[nets.btc])).confirmed, value, (v) => `${formatBtc(v)} BTC`);
    }
    const dec = tok ? tok.decimals : 18;
    const value = parseUnits(amt, dec);
    const bal = tok ? await tokenBalance(nets.eth, tok, mine.eth) : await ethBalance(nets.eth, mine.eth);
    return newDeviceGate(`eth:${ETH_NETS[nets.eth].chainId}:${tok ? tok.contract.toLowerCase() : 'native'}`, bal, value, (v) => `${formatUnits(v, dec, 6)} ${unit}`);
  };

  const review = async () => {
    setErr('');
    setBusy(true);
    try {
      if (!(await confirmIt('Prepare this payment', { keyFollows: true }))) return;
      const gate = await ndGate();
      if (!gate.ok) return setErr(gate.message);
      gateRef.current = gate;
      if (isBtc) {
        const sats = parseBtc(amt);
        const p = await prepareBtc(dest, sats, speed);
        setPrep({ kind: 'btc', net: p.net, hex: p.signed.hex, txid: p.signed.txid, lines: describeBtc({ plan: p.signed.plan, to: dest, from: p.from, net: p.net, rate: p.rate }) });
      } else {
        const amount = parseUnits(amt, tok ? tok.decimals : 18);
        const p = await prepareEth(dest, amount, speed, tok);
        setPrep({ kind: 'eth', net: p.net, raw: p.signed.raw, lines: describeEth({ net: p.net, to: dest, amount, token: tok, gas: p.gas, fees: p.fees }) });
      }
    } catch (e) {
      failure();
      setErr(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!prep) return false;
    setStage('sending');
    try {
      const id = prep.kind === 'btc' ? await broadcastBtc(prep.net, prep.hex) : await broadcastEth(prep.net, prep.raw);
      await rememberDestination(chain, dest);
      await notePendingFeed({ id: prep.kind === 'btc' ? `btc:${id}` : `eth:${nets.eth}:${id}`, coin: chain, kind: 'sent', time: 0, amount: amt.replace(/\.$/, ''), unit, failed: false, other: dest, net: isBtc ? BTC_NETS[nets.btc].label.replace('Bitcoin ', '') : ETH_NETS[nets.eth].short, url: isBtc ? `${BTC_NETS[nets.btc].esplora.replace(/\/api$/, '')}/tx/${id}` : `${ETH_NETS[nets.eth].explorer}/tx/${id}` });
      await gateRef.current?.commit();
      success();
      flyCoin('out', chain === 'btc' ? 'btc' : 'eth');
      setTxid(id);
      setSentAt(Date.now());
      setStage('waiting');
      watch(prep, id);
      return true;
    } catch (e) {
      failure();
      setStage('failed');
      setErr(plainError(e));
      return false;
    }
  };

  // look for the block every 15 seconds while this screen is open
  const watch = (p: Prepared, id: string) => {
    let n = 0;
    const t = setInterval(async () => {
      if (++n > 240) return clearInterval(t);
      try {
        const b = p.kind === 'btc' ? await btcTxBlock(p.net, id) : await ethTxBlock(p.net, id);
        if (b != null) {
          clearInterval(t);
          setBlock(b);
          setStage('done');
          success();
        }
      } catch (e) {
        clearInterval(t);
        setErr(plainError(e));
        setStage('failed');
      }
    }, 15_000);
  };

  const scan = () => router.replace(`/ring?mode=scan&for=${chain}${token ? `&token=${token}` : ''}`);
  const paste = async () => {
    const t = (await Clipboard.getStringAsync()).trim();
    const f = parsePayload(t);
    if (f && f.chain === chain && !(f.token && token && f.token.toLowerCase() !== token.toLowerCase())) {
      setTo(f.address);
      if (f.amount) setAmt(f.amount);
      if (f.units && tok) setAmt(formatUnits(BigInt(f.units), tok.decimals));
    } else setTo(t);
    setPrep(null);
  };

  if (unknownToken)
    return (
      <Screen title="Send a token" large>
        <Note>{`This request is for a token that is not in your wallet (${token!.slice(0, 8)}…${token!.slice(-6)}). Add it from Home › Add first, then scan again.`}</Note>
        <Button title="Add a coin" onPress={() => router.replace('/coins')} />
      </Screen>
    );

  if (stage) {
    const slip: SlipInput | null = txid && prep
      ? {
          amount: amt.replace(/\.$/, ''),
          unit,
          to: dest,
          toName: nameFor(dest),
          from: own || undefined,
          network: isBtc ? BTC_NETS[nets.btc].label : ETH_NETS[nets.eth].label,
          fee: feeFromLines(prep.lines),
          at: sentAt,
          hash: txid,
          testnet: !(isBtc ? BTC_NETS[nets.btc].real : ETH_NETS[nets.eth].real),
          url: isBtc ? `${BTC_NETS[nets.btc].esplora.replace(/\/api$/, '')}/tx/${txid}` : `${ETH_NETS[nets.eth].explorer}/tx/${txid}`,
        }
      : null;
    return <Progress chain={chain} to={dest} amount={`${amt} ${unit}`} stage={stage} block={block} err={err} isBtc={isBtc} slip={slip} />;
  }

  const mine = !!own && dest.toLowerCase() === own.toLowerCase();
  const badTo = dest && !valid ? `That is not a valid ${isBtc ? BTC_NETS[nets.btc].label : ETH_NETS[nets.eth].label} address.` : mine ? 'That is your own address.' : '';
  if (!prep)
    return (
      <SendCompose
        title={`Send ${unit}`}
        unit={unit}
        network={isBtc ? BTC_NETS[nets.btc].label : ETH_NETS[nets.eth].label}
        to={to}
        onTo={(t) => { setTo(t); setPrep(null); }}
        placeholder={isBtc ? (nets.btc === 'mainnet' ? 'bc1…' : 'tb1…') : '0x…'}
        onScan={scan}
        onPaste={paste}
        amt={amt}
        onAmt={(a) => { setAmt(a); setPrep(null); }}
        decimals={isBtc ? 8 : tok ? tok.decimals : 18}
        badTo={badTo}
        guard={dest && valid ? <DestGuard dest={dest} known={allKnown} onOk={setGuardOk} /> : null}
        have={held?.text}
        onMax={tok && held ? () => { setAmt(formatUnits(held.raw, tok.decimals, tok.decimals).replace(/,/g, '')); setPrep(null); } : undefined}
        below={<Segmented value={speed} options={[['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]} onChange={setSpeed} />}
        feeNote={`${speed === 'slow' ? 'Lowest fee, slower' : speed === 'fast' ? 'Higher fee, quicker' : 'Usual fee'} · ${isBtc ? (speed === 'fast' ? 'next block or two' : speed === 'slow' ? 'an hour or more' : 'about 30 minutes') : speed === 'fast' ? 'seconds' : speed === 'slow' ? 'a few minutes' : 'about a minute'}`}
        err={err}
        busy={busy}
        disabled={!valid || mine || !amt || !guardOk}
        onReview={review}
      />
    );
  return (
    <Screen title="Review">
      <SendReview amount={amt} unit={unit} to={dest} lines={prep.lines.slice(1)} />
      <ErrorText title="Couldn't send" note="If you're not sure it went through, check Activity before trying again.">{err}</ErrorText>
      <ApproveButton reason="Send this payment" onApproved={send} />
      <Button title="Change" kind="plain" onPress={() => setPrep(null)} />
      <Note>Transactions on Bitcoin and Ethereum cannot be undone.</Note>
    </Screen>
  );
}

/** After the slide: the recipient's own sun fills as the payment moves, then turns green in its block. */
function Progress({ chain, to, amount, stage, block, err, isBtc, slip }: { chain: 'btc' | 'eth'; to: string; amount: string; stage: FillStage; block: number | null; err: string; isBtc: boolean; slip: SlipInput | null }) {
  const slipOn = useReveal(stage === 'waiting' || stage === 'done') && !!slip;
  // your ring folds into the coin, the coin crosses to their address, and the amount settles where your ring was
  const coins = useCoins();
  const mine = coins[chain].address ?? '';
  const caption =
    stage === 'done' ? `In block ${block?.toLocaleString('en-US')}.` : stage === 'failed' ? err || 'It did not go through. Nothing left your wallet.' : stage === 'waiting' ? `Accepted by the network. ${isBtc ? 'Usually about 10 minutes.' : 'Usually under a minute.'}` : '';
  return (
    <Screen title="" large>
      {slipOn && slip ? (
        <View style={{ minHeight: 520, justifyContent: 'center' }}>
          <Slip slip={slip} done={stage === 'done'} caption={stage === 'done' ? `In block ${block?.toLocaleString('en-US')}` : `On its way · ${isBtc ? 'usually about 10 minutes' : 'usually under a minute'}`} />
        </View>
      ) : (
        <View style={{ height: 520 }}>
          <CoinLaunch
            stage={stage === 'signing' || stage === 'sending' ? 'sending' : stage}
            to={to}
            ring={mine ? (size) => <ChainRing chain={chain} address={mine} size={size} /> : null}
            toRing={(size) => <ChainRing chain={chain} address={to} size={size} centre={<View />} />}
            coin={(size) => <CoinLogo chain={chain} size={size} />}
            headline={stage === 'done' ? `Confirmed ${amount}` : `Sent ${amount}`}
            caption={caption}
          />
        </View>
      )}
      {slipOn && slip ? <Button title="Share receipt" kind="line" onPress={() => shareSlip(slip, stage === 'done')} /> : null}
      {(stage === 'done' || stage === 'failed' || stage === 'waiting') && <Button title="Done" kind={stage === 'waiting' ? 'line' : 'solid'} onPress={() => router.back()} />}
    </Screen>
  );
}
