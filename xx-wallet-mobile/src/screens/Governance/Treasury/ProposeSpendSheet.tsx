import { useEffect, useMemo, useState } from 'react';
import { BN } from '@polkadot/util';
import { Sheet, TxFooter } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { treasuryBond, useBalance, useTreasury } from '@/hooks';
import { formatBalance } from '@/utils';
import { isValidXxAddress } from '@/utils/address';
import { parseAmount } from '../Democracy/VoteSheet';

/**
 * Propose a treasury spend.
 *
 * Submits `treasury.proposeSpend(value, beneficiary)`. The bond is
 * computed from the chain consts via the bondPreview helper:
 *
 *   bond = clamp(proposalBondPerMill × value / 1M,
 *                proposalBondMinimum, proposalBondMaximum)
 *
 * The bond is REFUNDABLE — proposers get it back when their proposal
 * is either approved (paid out) or rejected. Only mis-conduct closes
 * a proposal in a way that forfeits the bond.
 *
 * The preview is visible before submit so users see exactly what
 * will be reserved. Submit stays disabled unless beneficiary is a
 * valid xx address AND value > 0 AND the proposer can cover the bond.
 */

interface ProposeSpendSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ProposeSpendSheet({ open, onClose }: ProposeSpendSheetProps) {
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
  const [beneficiary, setBeneficiary] = useState('');

  useEffect(() => {
    if (open) return;
    setValueStr('');
    setBeneficiary('');
  }, [open]);

  const valueBn = useMemo(() => parseAmount(valueStr), [valueStr]);
  const beneficiaryValid = useMemo(
    () => isValidXxAddress(beneficiary.trim()),
    [beneficiary]
  );

  const treasury = useTreasury();
  const { balance } = useBalance(signerAddress || null);
  const available = balance?.transferable ?? new BN(0);

  const bondPreview = useMemo(() => {
    if (!valueBn || !treasury.proposalBondMinimum) return null;
    return treasuryBond({
      value: valueBn,
      bondPerMill: treasury.proposalBondPerMill,
      bondMinimum: treasury.proposalBondMinimum,
      bondMaximum: treasury.proposalBondMaximum,
    });
  }, [valueBn, treasury]);

  const canCoverBond = !!bondPreview && available.gte(bondPreview);
  const formValid = !!valueBn && beneficiaryValid && canCoverBond;

  return (
    <Sheet open={open} onClose={onClose} title="Propose treasury spend">
      <div className="space-y-4">
        <ValueInput value={valueStr} onChange={setValueStr} />

        <BeneficiaryInput
          value={beneficiary}
          onChange={setBeneficiary}
          valid={beneficiary.trim().length === 0 || beneficiaryValid}
        />

        {bondPreview && (
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
            <p className="text-xs text-ink-400">Proposer bond (refundable)</p>
            <p className="font-mono text-base text-ink-100 numeric">
              {formatBalance(bondPreview, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              <span className="text-ink-400">XX</span>
            </p>
            <p className="text-xs text-ink-400">
              {formatBondRule(
                treasury.proposalBondPerMill,
                treasury.proposalBondMinimum,
                treasury.proposalBondMaximum
              )}
            </p>
            {!canCoverBond && (
              <p className="text-xs text-warning">
                Available balance ({' '}
                {formatBalance(available, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX) can't cover the bond.
              </p>
            )}
          </div>
        )}

        <TxFooter
          signerAddress={signerAddress}
          onSignerChange={setSignerAddress}
          accounts={accounts}
          txBuilder={(api) =>
            api.tx.treasury.proposeSpend(valueBn ?? new BN(0), beneficiary.trim())
          }
          formValid={formValid}
          submitLabel="Propose spend"
          successTitle="Proposal submitted"
          successBody="Council will vote on your proposal at the next spend period."
          onDismiss={onClose}
        />
      </div>
    </Sheet>
  );
}

function ValueInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Spend value</label>
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
      <p className="text-xs text-ink-400">
        Amount to be paid out from the treasury pot if approved.
      </p>
    </div>
  );
}

function BeneficiaryInput({
  value,
  onChange,
  valid,
}: {
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-ink-400">Beneficiary address</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="6Xx…"
        spellCheck={false}
        className={`w-full px-3 py-2.5 rounded-2xl bg-ink-900 border text-sm font-mono text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-ink-600 ${
          valid ? 'border-ink-800' : 'border-warning/50'
        }`}
      />
      {!valid && (
        <p className="text-xs text-warning">Not a valid xx address.</p>
      )}
    </div>
  );
}

function formatBondRule(
  perMill: number,
  min: BN | null,
  max: BN | null
): string {
  const pct = perMill / 10_000;
  const pctStr = `${pct.toFixed(pct >= 1 ? 0 : 2)}%`;
  const parts: string[] = [`${pctStr} of value`];
  if (min) {
    parts.push(
      `min ${formatBalance(min, { decimals: 0, trim: true, grouping: true })} XX`
    );
  }
  if (max) {
    parts.push(
      `max ${formatBalance(max, { decimals: 0, trim: true, grouping: true })} XX`
    );
  }
  return parts.join(' · ');
}
