import { useEffect, useMemo, useState } from 'react';
import { BN, hexToU8a, u8aToHex } from '@polkadot/util';
import type { ApiPromise } from '@polkadot/api';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { xxApi } from '@/api';
import { useBalance, boundedFor, validatePropose } from '@/hooks';
import { formatBalance, safeDecodeCall, normalizeCallBytes, type SafeDecodeResult } from '@/utils';
import { parseAmount } from './VoteSheet';

/**
 * Submit a public democracy proposal — `democracy.propose(Bounded, deposit)`.
 *
 * Spiked live 2026-07-08: xx v206 takes a BOUNDED proposal. Call encodings
 * ≤ 128 bytes submit Inline in one transaction; larger ones batch
 * `preimage.notePreimage(bytes)` + `propose(Lookup{hash,len})` atomically
 * via utility.batchAll. The deposit (≥ 100 XX minimum on mainnet) is
 * reserved until the proposal wins a launch period and becomes a referendum;
 * seconders match it.
 *
 * §6.4 discipline applies to what we PROPOSE, not just what we approve: the
 * call bytes are decoded locally and shown; bytes the wallet can't decode
 * are refused outright rather than submitted as trust-me governance.
 */

interface ProposeSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ProposeSheet({ open, onClose }: ProposeSheetProps) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );
  const [callHex, setCallHex] = useState('');
  const [depositStr, setDepositStr] = useState('');
  const [api, setApi] = useState<ApiPromise | null>(null);
  const [minDeposit, setMinDeposit] = useState<BN | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!signerAddress || !accounts.some((a) => a.address === signerAddress)) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
  }, [open, activeAddress, accounts, signerAddress]);

  useEffect(() => {
    if (open) return;
    setCallHex('');
    setDepositStr('');
  }, [open]);

  // The api instance is needed synchronously for live call decoding.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const a = await xxApi.getApi();
        if (cancelled) return;
        setApi(a);
        const md = (a.consts as any).democracy?.minimumDeposit;
        setMinDeposit(md ? md.toBn() : null);
      } catch {
        /* decode + min-deposit hints degrade; TxFooter still gates submit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const { balance } = useBalance(signerAddress || null);
  const available = useMemo(() => balance?.transferable ?? new BN(0), [balance]);

  const trimmedHex = callHex.trim();
  const callBytes = useMemo(() => {
    if (!trimmedHex) return null;
    try {
      return hexToU8a(normalizeCallBytes(trimmedHex));
    } catch {
      return null;
    }
  }, [trimmedHex]);

  const decoded: SafeDecodeResult | null = useMemo(() => {
    if (!callBytes || !api) return null;
    return safeDecodeCall(callBytes, api);
  }, [callBytes, api]);

  const shape = useMemo(() => (callBytes ? boundedFor(callBytes) : null), [callBytes]);
  const depositBn = useMemo(() => parseAmount(depositStr), [depositStr]);

  const validation = useMemo(
    () =>
      validatePropose({
        hasCall: !!callBytes,
        callDecodes: decoded?.ok === true,
        deposit: depositBn,
        minDeposit: minDeposit ?? new BN(0),
        available,
      }),
    [callBytes, decoded, depositBn, minDeposit, available]
  );

  const fmt = (v: BN) => `${formatBalance(v, { decimals: 4, trim: true, grouping: true })} XX`;

  return (
    <Sheet open={open} onClose={onClose} title="Submit a proposal">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs text-ink-300">Call data (hex)</label>
          <textarea
            value={callHex}
            onChange={(e) => setCallHex(e.target.value)}
            rows={3}
            placeholder="0x…"
            className="w-full px-3 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-xs font-mono text-ink-100 placeholder:text-ink-300 focus:outline-none focus:border-ink-600 break-all"
          />
          <p className="text-xs text-ink-300 leading-snug">
            The SCALE-encoded call this referendum would execute (e.g. built with a
            developer tool). The wallet decodes it locally before you sign.
          </p>
        </div>

        {decoded && (
          decoded.ok ? (
            <div className="rounded-xl border border-xx-500/30 bg-xx-500/5 p-3 space-y-1">
              <p className="text-xs text-ink-300">Decodes to</p>
              <p className="text-sm text-ink-100 font-mono break-all">
                {decoded.decoded.friendly ?? decoded.decoded.literal}
              </p>
              {shape && (
                <p className="text-xs text-ink-300">
                  {shape.kind === 'inline'
                    ? `${callBytes?.length} bytes — submits inline in one transaction.`
                    : `${shape.len} bytes — submits as a noted preimage (per-byte deposit) plus the proposal, in one atomic batch.`}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs text-ink-200 leading-relaxed">
                These bytes don't decode as a call on this chain, so the wallet won't
                propose them. Check the hex is a complete SCALE-encoded call.
              </p>
            </div>
          )
        )}

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label className="text-xs text-ink-300">Deposit</label>
            <span className="text-xs text-ink-300">
              Available: <span className="font-mono">{fmt(available)}</span>
            </span>
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={depositStr}
              onChange={(e) => setDepositStr(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder={minDeposit ? formatBalance(minDeposit, { decimals: 4, trim: true, grouping: false }) : '100'}
              className="w-full pl-3 pr-12 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-base font-mono text-ink-100 numeric placeholder:text-ink-300 focus:outline-none focus:border-ink-600"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-300 pointer-events-none">
              XX
            </span>
          </div>
          <p className="text-xs text-ink-300 leading-snug">
            Minimum {minDeposit ? fmt(minDeposit) : '100 XX'}. Reserved (not spent)
            until the proposal launches as a referendum; seconders match it. It can
            take multiple weekly launch periods for a proposal to reach the top of
            the queue.
          </p>
        </div>

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(a) => {
            const bytes = callBytes as Uint8Array;
            const s = boundedFor(bytes);
            const deposit = depositBn ?? new BN(0);
            if (s.kind === 'inline') {
              return (a.tx as any).democracy.propose({ Inline: u8aToHex(bytes) }, deposit);
            }
            return (a.tx as any).utility.batchAll([
              (a.tx as any).preimage.notePreimage(u8aToHex(bytes)),
              (a.tx as any).democracy.propose(
                { Lookup: { hash: u8aToHex(s.hash), len: s.len } },
                deposit
              ),
            ]);
          }}
          formValid={validation.ok === true}
          submitLabel="Submit proposal"
          successTitle="Proposal submitted"
          successBody="Your public proposal is on chain — it competes for the next launch period once seconded."
          onDismiss={onClose}
        />

        {validation.ok === false && (trimmedHex.length > 0 || depositStr.length > 0) && (
          <p className="text-xs text-warning text-center">{validationLabel(validation.error)}</p>
        )}
      </div>
    </Sheet>
  );
}

function validationLabel(
  e: Exclude<ReturnType<typeof validatePropose>, { ok: true }>['error']
): string {
  switch (e) {
    case 'call-required':
      return 'Paste the call data to propose.';
    case 'call-undecodable':
      return "The wallet won't propose bytes it can't decode.";
    case 'deposit-required':
      return 'Enter a deposit.';
    case 'deposit-below-minimum':
      return 'Deposit is below the chain minimum.';
    case 'insufficient-balance':
      return 'Deposit exceeds the available balance.';
  }
}
