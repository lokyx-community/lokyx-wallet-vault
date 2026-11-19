import { ETH_NETS, BLOCKSCOUT, type EthNet } from './multichain-core';
import { ethCode, fetchT } from './multichain';
import { auditOf, combineSources, decodeCall, isMinimalProxy, judge, parseBlockscout, parseSourcify, type Party, type SourceInfo, type Verdict, type DecodedCall } from './contract-check-core';

async function ask(url: string, parse: (status: number, json: unknown) => SourceInfo): Promise<SourceInfo> {
  try {
    const r = await fetchT(url, undefined, 8_000);
    let j: unknown = null;
    try {
      j = await r.json();
    } catch {
      /* not JSON */
    }
    return parse(r.status, j);
  } catch {
    return { source: 'unknown', proxy: false };
  }
}

/** One address: is it a contract, is its source public (either of two services), is it on our audited list. */
export async function checkParty(net: EthNet, address: string, role: Party['role']): Promise<Party> {
  let code: string | null = null;
  try {
    code = await ethCode(net, address);
  } catch {
    /* network down: "unknown" below */
  }
  const isContract = code == null ? null : code !== '0x';
  const audit = auditOf(address);
  if (isContract === false) return { role, address, isContract, source: 'unknown', proxy: false, audit: null };
  const bs = BLOCKSCOUT[net];
  const [a, b] = await Promise.all([
    bs ? ask(`${bs}/api/v2/smart-contracts/${address}`, parseBlockscout) : Promise.resolve<SourceInfo>({ source: 'unknown', proxy: false }),
    ask(`https://sourcify.dev/server/v2/contract/${ETH_NETS[net].chainId}/${address}`, parseSourcify),
  ]);
  const s = combineSources(bs ? [a, b] : [b]);
  return { role, address, isContract, source: s.source, proxy: s.proxy || (code != null && isMinimalProxy(code)), name: s.name, audit };
}

export interface ContractCheck {
  call: DecodedCall;
  parties: Party[];
  verdict: Verdict;
}

/** Everything the approval screen shows about a transaction that is more than a plain send to a person. Null when
 *  there is nothing to check (plain value to an ordinary address). Never throws: a failed look-up is "unknown". */
export async function checkTransaction(net: EthNet, to: string | null, data: string, value: bigint): Promise<ContractCheck | null> {
  const call = decodeCall(data);
  if (to == null) return { call, parties: [], verdict: judge(call, [], true, value) };
  const targets: Promise<Party>[] = [checkParty(net, to, 'contract')];
  if (call.spender && call.spender.toLowerCase() !== to.toLowerCase()) targets.push(checkParty(net, call.spender, 'spender'));
  const parties = await Promise.all(targets);
  if (call.kind === 'none' && parties[0].isContract === false) return null; // a plain payment to a person
  return { call, parties, verdict: judge(call, parties, false, value) };
}

/** If the check itself fails in an unexpected way, a call with data still stops and asks. */
export function failedCheck(to: string | null, data: string, value: bigint): ContractCheck | null {
  const call = decodeCall(data);
  if (to != null && call.kind === 'none') return null;
  const v = judge(call, [], to == null, value);
  const verdict = v.level === 'ok' ? { ...v, level: 'caution' as const, headline: 'No review on record', review: true } : v;
  return { call, parties: [], verdict: { ...verdict, reasons: ['The check did not complete.', ...verdict.reasons] } };
}
