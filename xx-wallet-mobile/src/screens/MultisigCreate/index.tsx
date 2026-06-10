/**
 * MultisigCreate — manual entry flow for adding a multisig.
 *
 * The user picks the (threshold, signers) tuple by hand. The wallet derives
 * the address locally and shows it as a live preview so typos are caught
 * before anyone funds the multisig.
 *
 * Constraint: the user's own active account is always one of the signers
 * (and is locked into the selection). The wallet only manages multisigs
 * the user is actually part of — there's no use case for a multisig you
 * don't participate in, since you couldn't approve or propose at it.
 *
 * This is one of three ways to add a multisig; the others are import
 * from a shared config JSON (MultisigImport) and discovery via chain
 * scan (MultisigScan).
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, Users, Check, X, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressIcon } from '@/components/ui';
import { useAccountsStore, useAddressBook, useMultisigsStore } from '@/store';
import {
  deriveMultisigAddress,
  shortenAddress,
} from '@/utils';

interface SignerCandidate {
  address: string;
  /** Display label — account name, contact name, or empty. */
  label: string;
  /** Source identifier — "self" for your own active account, "account" for
   *  other own accounts, "contact" for address-book entries. Used for
   *  rendering hints (badge, lock state). */
  source: 'self' | 'account' | 'contact';
}

export function MultisigCreate() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const { contacts } = useAddressBook();
  const addMultisig = useMultisigsStore((s) => s.addMultisig);

  const activeAccount = accounts.find((a) => a.address === activeAddress);

  // Build the candidate pool: user's active account first (locked), then
  // any other own accounts, then address book contacts.
  const candidates = useMemo<SignerCandidate[]>(() => {
    const list: SignerCandidate[] = [];
    if (activeAccount) {
      list.push({
        address: activeAccount.address,
        label: activeAccount.name,
        source: 'self',
      });
    }
    for (const acct of accounts) {
      if (acct.address === activeAccount?.address) continue;
      list.push({
        address: acct.address,
        label: acct.name,
        source: 'account',
      });
    }
    for (const contact of contacts) {
      // Skip contacts that duplicate own accounts (would be a confusing
      // double row in the picker).
      if (accounts.some((a) => a.address === contact.address)) continue;
      list.push({
        address: contact.address,
        label: contact.name || '(unnamed contact)',
        source: 'contact',
      });
    }
    return list;
  }, [accounts, activeAccount, contacts]);

  // Selected signer addresses, in selection order. Self is always present
  // and at index 0.
  const [selected, setSelected] = useState<string[]>(() =>
    activeAccount ? [activeAccount.address] : []
  );

  // Form fields
  const [nickname, setNickname] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Toggle a signer in/out of the selection. Self can't be unchecked.
  const toggleSigner = (address: string) => {
    if (address === activeAccount?.address) return;
    setSelected((current) => {
      if (current.includes(address)) {
        return current.filter((a) => a !== address);
      }
      const next = [...current, address];
      // Auto-bump threshold if we added a signer and threshold was at
      // the previous N (so 2-of-2 stays as 2-of-2, but 2-of-3 becomes
      // 2-of-4 instead of jumping to 3-of-4).
      return next;
    });
  };

  // Live derivation. We re-derive on every render — it's cheap (single
  // blake2 hash) and avoids a stale-display bug if anything mutated.
  const derivedAddress = useMemo(() => {
    if (selected.length < 2) return null;
    if (threshold < 1 || threshold > selected.length) return null;
    try {
      return deriveMultisigAddress(threshold, selected);
    } catch {
      return null;
    }
  }, [threshold, selected]);

  // Is this multisig already in the wallet?
  const existingMultisig = useMultisigsStore((s) =>
    derivedAddress ? s.getMultisig(derivedAddress) : undefined
  );

  // Validation gates
  const enoughSigners = selected.length >= 2;
  const thresholdValid =
    Number.isInteger(threshold) && threshold >= 1 && threshold <= selected.length;
  const trimmedNickname = nickname.trim();
  const nicknameValid = trimmedNickname.length > 0 && trimmedNickname.length <= 64;
  const canSubmit =
    enoughSigners &&
    thresholdValid &&
    nicknameValid &&
    derivedAddress !== null &&
    !existingMultisig &&
    !submitting;

  // Clamp threshold whenever signer count changes — prevents "5-of-3" states.
  if (threshold > selected.length && selected.length >= 1 && threshold !== 2) {
    // Defer to avoid setState-during-render warnings.
    setTimeout(() => setThreshold(Math.min(threshold, selected.length)), 0);
  }

  if (!activeAccount) {
    // Should be unreachable (RequireAccount wraps this route) but defensive.
    return (
      <>
        <TopBar title="Add multisig" showBack />
        <div className="px-5 py-6 max-w-md mx-auto">
          <p className="text-sm text-ink-300">
            You need at least one account in your wallet before you can add a
            multisig. Set up an account first.
          </p>
        </div>
      </>
    );
  }

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const multisig = await addMultisig({
        threshold,
        signers: selected,
        localName: trimmedNickname,
      });
      navigate(`/multisig/${multisig.address}`, { replace: true });
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to add multisig.');
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title="Add multisig" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5 pb-24">
        {/* Nickname */}
        <div className="card space-y-2">
          <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
            Nickname
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Foundation Operations"
            maxLength={64}
            className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-ink-100 text-sm focus:outline-none focus:border-xx-500"
          />
          <p className="text-xs text-ink-400 leading-relaxed">
            Local label, only visible to you. Other signers can use a
            different name for the same multisig — it doesn't affect the
            shared address.
          </p>
        </div>

        {/* Signer picker */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Signers ({selected.length} selected)
            </p>
            {selected.length < 2 && (
              <span className="text-xs text-amber-400">need ≥ 2</span>
            )}
          </div>
          {candidates.length === 1 && (
            <p className="text-xs text-ink-400 leading-relaxed">
              Only your own account is available. Add other signers'
              addresses to your address book first, then come back here.
            </p>
          )}
          <div className="space-y-1.5">
            {candidates.map((c) => {
              const isSelected = selected.includes(c.address);
              const isLocked = c.source === 'self';
              return (
                <button
                  key={c.address}
                  type="button"
                  onClick={() => toggleSigner(c.address)}
                  disabled={isLocked}
                  className={clsx(
                    'w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors',
                    isSelected
                      ? 'bg-xx-500/10 border border-xx-500/30'
                      : 'bg-ink-900 border border-ink-700 active:bg-ink-800',
                    isLocked && 'opacity-90 cursor-default'
                  )}
                >
                  <AddressIcon address={c.address} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink-100 truncate">
                        {c.label}
                      </p>
                      {c.source === 'self' && (
                        <span className="text-xs uppercase tracking-wider text-xx-500 font-medium">
                          you
                        </span>
                      )}
                      {c.source === 'contact' && (
                        <span className="text-xs uppercase tracking-wider text-ink-400">
                          contact
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-ink-400 truncate">
                      {shortenAddress(c.address, { start: 8, end: 6 })}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    {isSelected ? (
                      <div className="w-5 h-5 rounded-full bg-xx-500 flex items-center justify-center">
                        <Check size={12} strokeWidth={2.5} className="text-ink-950" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-ink-600" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Threshold */}
        <div className="card space-y-3">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Threshold (signatures required)
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setThreshold((t) => Math.max(1, t - 1))}
              disabled={threshold <= 1}
              className="w-10 h-10 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center active:bg-ink-700 disabled:opacity-40"
              aria-label="Decrease threshold"
            >
              <Minus size={16} strokeWidth={2} />
            </button>
            <div className="flex items-baseline gap-1.5 min-w-[6rem] justify-center">
              <span className="text-3xl font-display font-medium text-ink-100 numeric">
                {threshold}
              </span>
              <span className="text-sm text-ink-400">of {selected.length}</span>
            </div>
            <button
              type="button"
              onClick={() =>
                setThreshold((t) => Math.min(selected.length, t + 1))
              }
              disabled={threshold >= selected.length}
              className="w-10 h-10 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center active:bg-ink-700 disabled:opacity-40"
              aria-label="Increase threshold"
            >
              <Plus size={16} strokeWidth={2} />
            </button>
          </div>
          <p className="text-xs text-ink-400 text-center leading-relaxed">
            {threshold} of the {selected.length} signers must approve any
            action from this multisig before it executes.
          </p>
        </div>

        {/* Live preview of the derived address */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Multisig address (derived)
          </p>
          {derivedAddress ? (
            <>
              <p className="font-mono text-xs text-ink-100 break-all leading-snug select-all">
                {derivedAddress}
              </p>
              <p className="text-xs text-ink-400 leading-relaxed">
                Computed locally from your threshold + signers. Other
                signers entering the same parameters will derive the same
                address — that's how everyone ends up on the same multisig.
              </p>
              {existingMultisig && (
                <div className="flex items-start gap-2 mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle
                    size={14}
                    strokeWidth={2}
                    className="text-amber-400 mt-0.5 flex-shrink-0"
                  />
                  <p className="text-xs text-amber-200 leading-snug">
                    This multisig is already in your wallet as
                    <span className="font-medium"> "{existingMultisig.localName}"</span>.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-ink-400">
              {selected.length < 2
                ? 'Pick at least 2 signers to see the derived address.'
                : 'Adjust the threshold to a valid value.'}
            </p>
          )}
        </div>

        {/* Submit */}
        <div className="space-y-2">
          {submitError && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-danger/10 border border-danger/30">
              <X size={14} strokeWidth={2.25} className="text-danger mt-0.5 flex-shrink-0" />
              <p className="text-xs text-danger leading-snug">{submitError}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={clsx(
              'btn-primary w-full',
              !canSubmit && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Users size={16} strokeWidth={2} />
            {submitting ? 'Adding…' : 'Add multisig'}
          </button>
        </div>
      </div>
    </>
  );
}
