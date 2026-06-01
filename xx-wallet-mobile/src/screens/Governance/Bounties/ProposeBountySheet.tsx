import { useEffect, useMemo, useState } from 'react';
import { BN } from '@polkadot/util';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { xxApi } from '@/api';
import { bountyDeposit, useBalance, utf8ByteLength } from '@/hooks';
import { formatBalance } from '@/utils';
import { parseAmount } from '../Democracy/VoteSheet';

/**
 * Propose a bounty.
 *
 * Submits `bounties.proposeBounty(value, description)`. The deposit
 * is computed from the chain consts:
 *
 *   deposit = bountyDepositBase + (description.utf8Bytes × dataDepositPerByte)
 *
 * On xx v206: 1 XX base + 0.01 XX/byte. A 100-byte description
 * = 2 XX deposit. A 16,384-byte description (the max) = ~164 XX.
 *
 * The deposit is REFUNDABLE when the bounty's funding is approved or
 * the bounty is closed without award. Lost on misconduct.
 *
 * Description goes on chain verbatim — the foundation's convention is
 * to wrap a forum.xx.network link in an HTML anchor, but the sheet
 * stays neutral and accepts whatever the user types. Bytes counter is
 * visible so users see the cost-of-detail tradeoff.
 */

interface ProposeBountySheetProps {
  open: boolean;
  onClose: () => void;
}

interface BountyConsts {
  depositBase: BN;
  dataDepositPerByte: BN;
  maximumReasonLength: number;
  bountyValueMinimum: BN;
}

export function ProposeBountySheet({ open, onClose }: ProposeBountySheetProps) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );

  useEffect(() => {
    if (!open) return;
    if (!signerAddress || !accounts.some((a) => a.address === signerAddress)) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
  }, [open, activeAddress, accounts, signerAddress]);

  const [valueStr, setValueStr] = useState('');
  const [description, setDescription] = useState('');
  const [consts, setConsts] = useState<BountyConsts | null>(null);
  const [constsError, setConstsError] = useState<Error | null>(null);

  useEffect(() => {
    if (!open) {
      setValueStr('');
      setDescription('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;
        const c: any = api.consts.bounties ?? {};
        setConsts({
          depositBase: c.bountyDepositBase?.toBn?.() ?? new BN(0),
          dataDepositPerByte: c.dataDepositPerByte?.toBn?.() ?? new BN(0),
          maximumReasonLength: c.maximumReasonLength
            ? Number(c.maximumReasonLength.toString())
            : 16_384,
          bountyValueMinimum:
            c.bountyValueMinimum?.toBn?.() ?? new BN(0),
        });
        setConstsError(null);
      } catch (e) {
        if (cancelled) return;
        setConstsError(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const valueBn = useMemo(() => parseAmount(valueStr), [valueStr]);
  const descBytes = useMemo(() => utf8ByteLength(description), [description]);
  const overLengthLimit = consts
    ? descBytes > consts.maximumReasonLength
    : false;

  const { balance } = useBalance(signerAddress || null);
  const available = balance?.transferable ?? new BN(0);

  const depositPreview = useMemo(() => {
    if (!consts) return null;
    return bountyDeposit({
      descriptionBytes: descBytes,
      depositBase: consts.depositBase,
      dataDepositPerByte: consts.dataDepositPerByte,
    });
  }, [consts, descBytes]);

  const valueMeetsMinimum =
    !!valueBn && !!consts && valueBn.gte(consts.bountyValueMinimum);
  const canCoverDeposit = !!depositPreview && available.gte(depositPreview);
  const formValid =
    valueMeetsMinimum &&
    description.trim().length > 0 &&
    !overLengthLimit &&
    canCoverDeposit;

  return (
    <Sheet open={open} onClose={onClose} title="Propose bounty">
      <div className="space-y-4">
        <ValueInput
          value={valueStr}
          onChange={setValueStr}
          minimum={consts?.bountyValueMinimum}
          tooLow={!!valueBn && !valueMeetsMinimum}
        />

        <DescriptionInput
          value={description}
          onChange={setDescription}
          byteCount={descBytes}
          maxBytes={consts?.maximumReasonLength ?? 16_384}
          tooLong={overLengthLimit}
        />

        {constsError && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
            <p className="text-xs text-warning">
              Couldn't read bounty constants
            </p>
            <p className="text-xs text-ink-400 font-mono break-all">
              {constsError.message}
            </p>
          </div>
        )}

        {depositPreview && (
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
            <p className="text-xs text-ink-400">Proposer deposit (refundable)</p>
            <p className="font-mono text-base text-ink-100 numeric">
              {formatBalance(depositPreview, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              <span className="text-ink-400">XX</span>
            </p>
            {consts && (
              <p className="text-xs text-ink-400">
                {formatBalance(consts.depositBase, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX base · {descBytes} bytes ×{' '}
                {formatBalance(consts.dataDepositPerByte, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX/byte
              </p>
            )}
            {!canCoverDeposit && (
              <p className="text-xs text-warning">
                Available balance ({' '}
                {formatBalance(available, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX) can't cover the deposit.
              </p>
            )}
          </div>
        )}

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) =>
            api.tx.bounties.proposeBounty(valueBn ?? new BN(0), description)
          }
          formValid={formValid}
          submitLabel="Propose bounty"
          successTitle="Bounty proposed"
          successBody="Council will fund or reject it at a future motion."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}

function ValueInput({
  value,
  onChange,
  minimum,
  tooLow,
}: {
  value: string;
  onChange: (v: string) => void;
  minimum?: BN;
  tooLow: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Bounty value</label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.0000"
          className="w-full pl-3 pr-12 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-base font-mono text-ink-100 numeric placeholder:text-ink-500 focus:outline-none focus:border-ink-600"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400 pointer-events-none">
          XX
        </span>
      </div>
      {minimum && (
        <p className="text-xs text-ink-400">
          Minimum:{' '}
          <span className="font-mono">
            {formatBalance(minimum, {
              decimals: 4,
              trim: true,
              grouping: true,
            })}{' '}
            XX
          </span>
        </p>
      )}
      {tooLow && (
        <p className="text-xs text-warning">
          Value is below the chain's bountyValueMinimum.
        </p>
      )}
    </div>
  );
}

function DescriptionInput({
  value,
  onChange,
  byteCount,
  maxBytes,
  tooLong,
}: {
  value: string;
  onChange: (v: string) => void;
  byteCount: number;
  maxBytes: number;
  tooLong: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs text-ink-400">Description</label>
        <span
          className={`text-xs font-mono ${
            tooLong ? 'text-danger' : 'text-ink-400'
          }`}
        >
          {byteCount} / {maxBytes} bytes
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder='Short title or forum link, e.g. <a href="https://forum.xx.network/t/your-bounty/123">xxB-2026-X title</a>'
        className={`w-full px-3 py-2.5 rounded-2xl bg-ink-900 border text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-ink-600 resize-y ${
          tooLong ? 'border-danger/50' : 'border-ink-800'
        }`}
      />
      <p className="text-xs text-ink-400">
        Foundation convention: wrap a forum.xx.network thread in an
        HTML anchor so the bounty list can link out cleanly.
      </p>
    </div>
  );
}
