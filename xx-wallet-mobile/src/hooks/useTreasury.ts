/**
 * useTreasury — read-only state for /governance/treasury.
 *
 * The treasury pallet on xx is mostly empty (8 historical proposals,
 * 0 pending, 0 awaiting payout at observation) so this hook is
 * primarily about rendering the *header* — pot balance + spend
 * period countdown + burn rate — and a small empty-state list.
 *
 * What we fetch (one parallel batch):
 *   - Treasury account derived from `consts.treasury.palletId` via
 *     substrate's into_account_truncating convention; then
 *     `system.account(treasuryAddr)` for the pot balance.
 *   - `treasury.proposalCount` — historical total of proposals ever made.
 *   - `treasury.approvals()` — Vec<u32> of proposal IDs the council has
 *     approved and which are awaiting payout at the next spend period.
 *   - `treasury.proposals.entries()` — currently pending proposals
 *     (those the council hasn't decided yet).
 *   - Constants: spendPeriod, burn (Permill), proposalBond (Permill),
 *     proposalBondMinimum, proposalBondMaximum.
 *
 * Pending proposals are read by named field (proposer, value,
 * beneficiary, bond) — never by array-destructure, per
 * feedback_chain_enum_decoding. The Slice 3.1 SeatHolder bug is the
 * reference for why.
 *
 * Identity prefetch for all visible proposers + beneficiaries fires
 * in the background.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { deriveModuleAccount, resolveIdentitiesBatch } from '@/governance';

export interface TreasuryProposal {
  id: number;
  proposer: string;
  value: BN;
  beneficiary: string;
  bond: BN;
}

interface UseTreasuryResult {
  /** Derived treasury account SS58, or null if the palletId const is missing. */
  treasuryAddress: string | null;
  /** Free balance held at the treasury account, in planck. */
  potBalance: BN | null;
  /** Pending proposals (council hasn't decided yet). */
  pendingProposals: TreasuryProposal[];
  /** Proposal IDs approved by council and awaiting payout next spend period. */
  approvalsQueue: number[];
  /** Historical count of all treasury proposals ever made. */
  proposalCountHistorical: number;
  /** Spend period in blocks (345,600 on xx = 24 days). */
  spendPeriod: number;
  /** Burn rate as Permill (10,000 = 1%). 0 if absent. */
  burnPerMill: number;
  /** Proposal bond percent (Permill). */
  proposalBondPerMill: number;
  /** Minimum proposal bond in planck. */
  proposalBondMinimum: BN | null;
  /** Maximum proposal bond in planck. */
  proposalBondMaximum: BN | null;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_RESULT: UseTreasuryResult = {
  treasuryAddress: null,
  potBalance: null,
  pendingProposals: [],
  approvalsQueue: [],
  proposalCountHistorical: 0,
  spendPeriod: 0,
  burnPerMill: 0,
  proposalBondPerMill: 0,
  proposalBondMinimum: null,
  proposalBondMaximum: null,
  isLoading: true,
  error: null,
};

export function useTreasury(): UseTreasuryResult {
  const [state, setState] = useState<UseTreasuryResult>(EMPTY_RESULT);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const consts: any = api.consts.treasury ?? {};
        const palletIdCodec = consts.palletId;
        const spendPeriod = numFromConst(consts.spendPeriod);
        const burnPerMill = numFromConst(consts.burn);
        const proposalBondPerMill = numFromConst(consts.proposalBond);
        const proposalBondMinimum = consts.proposalBondMinimum
          ? consts.proposalBondMinimum.toBn()
          : null;
        const proposalBondMaximum = consts.proposalBondMaximum
          ? consts.proposalBondMaximum.toBn()
          : null;

        // Derive treasury account from palletId (8 bytes — toU8a yields exactly that).
        let treasuryAddress: string | null = null;
        if (palletIdCodec?.toU8a) {
          try {
            const bytes: Uint8Array = palletIdCodec.toU8a();
            // Some codec Bytes types prepend a length; if it's longer than 8, slice.
            const palletId =
              bytes.length === 8 ? bytes : bytes.slice(bytes.length - 8);
            treasuryAddress = deriveModuleAccount(palletId);
          } catch {
            treasuryAddress = null;
          }
        }

        // Independent fetches via Promise.allSettled — a failure in any
        // one branch leaves the others available. Without this, an
        // exception decoding the proposals storage shape (the
        // feedback_chain_enum_decoding class of bug) would blank the
        // entire screen, including the pot balance which lives on a
        // completely different code path.
        //
        // Each branch logs its own error so phone-test inspection of
        // the deployed build narrows down which call actually failed.
        const [
          accountInfoResult,
          proposalCountResult,
          approvalsResult,
          proposalEntriesResult,
        ] = await Promise.allSettled([
          treasuryAddress
            ? api.query.system.account(treasuryAddress)
            : Promise.resolve(null),
          api.query.treasury.proposalCount(),
          api.query.treasury.approvals(),
          api.query.treasury.proposals.entries(),
        ]);
        if (cancelled) return;

        const potBalance = readPotBalance(accountInfoResult);
        const proposalCountHistorical = readProposalCount(proposalCountResult);
        const approvalsQueue = readApprovalsQueue(approvalsResult);
        const pendingProposals = readPendingProposals(proposalEntriesResult);

        // Identity prefetch.
        const ids = new Set<string>();
        for (const p of pendingProposals) {
          ids.add(p.proposer);
          ids.add(p.beneficiary);
        }
        if (ids.size > 0) {
          resolveIdentitiesBatch([...ids]).catch(() => {
            /* not load-bearing */
          });
        }

        if (cancelled) return;
        setState({
          treasuryAddress,
          potBalance,
          pendingProposals,
          approvalsQueue,
          proposalCountHistorical,
          spendPeriod,
          burnPerMill,
          proposalBondPerMill,
          proposalBondMinimum,
          proposalBondMaximum,
          isLoading: false,
          // The error field stays null here even on partial failure —
          // it's reserved for the unrecoverable case (api itself
          // wouldn't connect, exception in the outer try). Branch
          // failures degrade gracefully through the readers above.
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

// ---- Per-branch readers for the Promise.allSettled fan-out ----
//
// Each one accepts a PromiseSettledResult. Successes get decoded into
// the typed value; rejections get logged with a recognisable prefix
// and the default returned. The console-log discipline matters because
// it gives the next phone-test a way to narrow down which call failed
// (open Chrome remote-debug → console, see "[useTreasury] proposals
// fetch failed: …" or similar).

function readPotBalance(
  result: PromiseSettledResult<unknown>
): BN | null {
  if (result.status === 'rejected') {
    console.warn('[useTreasury] pot balance fetch failed:', result.reason);
    return null;
  }
  const accountInfo: any = result.value;
  if (!accountInfo?.data?.free?.toBn) return null;
  try {
    return accountInfo.data.free.toBn();
  } catch (e) {
    console.warn('[useTreasury] pot balance decode failed:', e);
    return null;
  }
}

function readProposalCount(result: PromiseSettledResult<unknown>): number {
  if (result.status === 'rejected') {
    console.warn('[useTreasury] proposalCount fetch failed:', result.reason);
    return 0;
  }
  try {
    return (result.value as any).toNumber();
  } catch (e) {
    console.warn('[useTreasury] proposalCount decode failed:', e);
    return 0;
  }
}

function readApprovalsQueue(result: PromiseSettledResult<unknown>): number[] {
  if (result.status === 'rejected') {
    console.warn('[useTreasury] approvals fetch failed:', result.reason);
    return [];
  }
  const codec: any = result.value;
  if (!codec) return [];
  try {
    return [...codec].map((id: any) => id.toNumber());
  } catch (e) {
    console.warn('[useTreasury] approvals decode failed:', e);
    return [];
  }
}

function readPendingProposals(
  result: PromiseSettledResult<unknown>
): TreasuryProposal[] {
  if (result.status === 'rejected') {
    console.warn(
      '[useTreasury] proposals.entries fetch failed:',
      result.reason
    );
    return [];
  }
  const entries: any = result.value;
  if (!entries) return [];
  const out: TreasuryProposal[] = [];
  try {
    for (const [key, opt] of entries as any[]) {
      if (!opt?.isSome) continue;
      const parsed = parseProposal(key, opt.unwrap());
      if (parsed) out.push(parsed);
    }
  } catch (e) {
    console.warn('[useTreasury] proposals.entries decode failed:', e);
    return [];
  }
  // Sort newest first by id.
  out.sort((a, b) => b.id - a.id);
  return out;
}

/**
 * Parse a treasury Proposal struct by named field — never array
 * destructure (per feedback_chain_enum_decoding). Returns null for
 * unparseable entries so the row is skipped rather than rendered
 * with garbage.
 *
 * Exported for testing.
 */
export function parseProposal(key: any, prop: any): TreasuryProposal | null {
  try {
    const id = key.args[0]?.toNumber?.();
    if (typeof id !== 'number' || !Number.isFinite(id)) return null;
    if (!prop?.proposer?.toString) return null;
    const proposer = prop.proposer.toString();
    if (!proposer.startsWith('6')) return null;
    if (!prop?.beneficiary?.toString) return null;
    const beneficiary = prop.beneficiary.toString();
    if (!beneficiary.startsWith('6')) return null;
    const value = prop.value?.toBn?.() ?? null;
    const bond = prop.bond?.toBn?.() ?? null;
    if (!value || !bond) return null;
    return { id, proposer, value, beneficiary, bond };
  } catch {
    return null;
  }
}
