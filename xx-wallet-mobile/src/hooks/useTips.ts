/**
 * useTips — read-only state for the Tips sub-tab of /governance/treasury.
 *
 * Tips are a small-grant flow on the treasury pallet: any user can
 * `reportAwesome(reason, who)` to suggest a tip; council members
 * endorse via `tip(hash, value)`; once endorsement count crosses a
 * threshold the median tip value is paid out from the treasury after
 * `tipCountdown` blocks.
 *
 * On xx there are 0 active tips at observation, so this hook is
 * primarily about an empty-state render. The parser path is written
 * defensively for the day a tip lands.
 *
 * The OpenTip struct is read by named field (`tip.who`, `tip.finder`,
 * etc.) — never by array destructure, per feedback_chain_enum_decoding.
 */

import { useEffect, useState } from 'react';
import { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { resolveIdentitiesBatch } from '@/governance';

export interface TipEntry {
  /** 0x-prefixed tip hash. The chain uses this as the storage key. */
  hash: string;
  /** Account being tipped. */
  who: string;
  /** Account that reported the tip. */
  finder: string;
  /** Bond posted by the finder. */
  deposit: BN | null;
  /** Number of council members who have endorsed with a tip value. */
  endorserCount: number;
  /** Sum of endorser tip values, in planck. */
  endorsementSum: BN | null;
  /** Block at which voting closes, if endorsement threshold has been crossed. */
  closesAt: number | null;
}

interface UseTipsResult {
  tips: TipEntry[];
  /** Countdown period in blocks after threshold is crossed before payout. */
  tipCountdown: number;
  /** Finder's fee as Percent (out of 100). */
  findersFeePercent: number;
  /** Required base deposit to report a tip, in planck. */
  reportDepositBase: BN | null;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_RESULT: UseTipsResult = {
  tips: [],
  tipCountdown: 0,
  findersFeePercent: 0,
  reportDepositBase: null,
  isLoading: true,
  error: null,
};

export function useTips(): UseTipsResult {
  const [state, setState] = useState<UseTipsResult>(EMPTY_RESULT);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        // tips pallet may not be present on every chain — guard.
        const tipsModule: any = api.query.tips;
        if (!tipsModule?.tips?.entries) {
          setState({ ...EMPTY_RESULT, isLoading: false });
          return;
        }

        const consts: any = api.consts.tips ?? {};
        const tipCountdown = numFromConst(consts.tipCountdown);
        // tipFindersFee is a Percent (0–100 directly).
        const findersFeePercent = numFromConst(consts.tipFindersFee);
        const reportDepositBase = consts.tipReportDepositBase
          ? consts.tipReportDepositBase.toBn()
          : null;

        const tipEntries: any[] = await tipsModule.tips.entries();
        if (cancelled) return;

        const tips: TipEntry[] = [];
        for (const [key, opt] of tipEntries) {
          if (!opt.isSome) continue;
          const parsed = parseOpenTip(key, opt.unwrap());
          if (parsed) tips.push(parsed);
        }
        // Newest endorsement first — closesAt fills in once threshold is
        // crossed, so use it when present, otherwise leave order stable.
        tips.sort((a, b) => (b.closesAt ?? 0) - (a.closesAt ?? 0));

        // Identity prefetch for finders + tipped accounts.
        const ids = new Set<string>();
        for (const t of tips) {
          ids.add(t.finder);
          ids.add(t.who);
        }
        if (ids.size > 0) {
          resolveIdentitiesBatch([...ids]).catch(() => {
            /* not load-bearing */
          });
        }

        if (cancelled) return;
        setState({
          tips,
          tipCountdown,
          findersFeePercent,
          reportDepositBase,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err as Error,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function numFromConst(c: any): number {
  if (c == null) return 0;
  if (typeof c.toNumber === 'function') return c.toNumber();
  return Number(c.toString());
}

/**
 * Parse an OpenTip struct by named field — never array destructure
 * (per feedback_chain_enum_decoding). Returns null for unparseable
 * entries so the row is skipped rather than rendered with garbage.
 *
 * Endorsements live inside `tip.tips` as a Vec<(AccountId, Balance)>.
 * We sum the balances rather than render each individually — Slice 4
 * shows aggregate values; per-endorser detail can come later.
 *
 * Exported for testing.
 */
export function parseOpenTip(key: any, tip: any): TipEntry | null {
  try {
    const hash = key.args[0]?.toHex?.();
    if (!hash) return null;
    if (!tip?.who?.toString || !tip?.finder?.toString) return null;
    const who = tip.who.toString();
    const finder = tip.finder.toString();
    if (!who.startsWith('6') || !finder.startsWith('6')) return null;
    const deposit = tip.deposit?.toBn?.() ?? null;

    // tip.tips is Vec<(AccountId, Balance)>. Iterate and sum the balance
    // half. Each entry is a true tuple (not a SeatHolder-style struct),
    // but we accept either shape since it costs nothing.
    const tipsCodec: any = tip.tips;
    let endorserCount = 0;
    let endorsementSum: BN | null = null;
    if (Array.isArray(tipsCodec)) {
      let sum = new BN(0);
      for (const entry of tipsCodec) {
        try {
          let bal: BN | null = null;
          if (entry?.value?.toBn) {
            bal = entry.value.toBn();
          } else if (Array.isArray(entry)) {
            const [, balCodec] = entry;
            bal = balCodec?.toBn?.() ?? null;
          }
          if (bal) {
            sum = sum.add(bal);
            endorserCount += 1;
          }
        } catch {
          /* skip endorser */
        }
      }
      if (endorserCount > 0) endorsementSum = sum;
    }

    // closesAt is Option<BlockNumber>.
    let closesAt: number | null = null;
    const closesCodec: any = tip.closes;
    if (closesCodec?.isSome) {
      closesAt = closesCodec.unwrap().toNumber();
    }

    return {
      hash,
      who,
      finder,
      deposit,
      endorserCount,
      endorsementSum,
      closesAt,
    };
  } catch {
    return null;
  }
}
