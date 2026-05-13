/**
 * MultisigScan — Path C of the multisig add flow.
 *
 * User-initiated chain scan. Walks the indexer for past multisig
 * activity involving any of the user's wallet accounts and surfaces
 * the discovered multisigs for selective import. Never runs
 * automatically — per design doc §11.5, auto-scanning the chain on
 * behalf of the user would feel like surveillance.
 *
 * Discovered multisigs are filtered against what's already in the
 * user's local store; only NEW ones are offered. Each row has a
 * checkbox so the user picks which to import — they may have legacy
 * multisigs they no longer care about, and we shouldn't force-import
 * everything.
 *
 * The "verify with cosigner out-of-band" gate from Path B applies
 * here too (anyone can put your address into a multisig signer set
 * on chain; that alone is not proof you should sign for it).
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Key,
  Loader2,
  Search,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel } from '@/components/ui';
import { useAccountsStore, useAddressBook, useMultisigsStore } from '@/store';
import {
  scanForUserMultisigs,
  shortenAddress,
  type DiscoveredMultisig,
} from '@/utils';

type Phase = 'idle' | 'scanning' | 'results';

export function MultisigScan() {
  const navigate = useNavigate();
  const { accounts } = useAccountsStore();
  const { contacts, addContact } = useAddressBook();
  const addMultisig = useMultisigsStore((s) => s.addMultisig);
  const existingMultisigs = useMultisigsStore((s) => s.multisigs);

  const [phase, setPhase] = useState<Phase>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [results, setResults] = useState<DiscoveredMultisig[]>([]);

  // Selection state — keyed by multisig address. Each entry tracks the
  // user-chosen local nickname and the per-signer labels they want
  // saved with this multisig. Empty entry = unchecked.
  interface Selection {
    nickname: string;
    labels: Record<string, string>;
  }
  const [selections, setSelections] = useState<Record<string, Selection>>({});

  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Filter scan results: drop any multisig already in the wallet so
  // the user only sees NEW discoveries.
  const newDiscoveries = useMemo(
    () =>
      results.filter(
        (d) => !existingMultisigs.some((m) => m.address === d.address)
      ),
    [results, existingMultisigs]
  );

  const handleScan = async () => {
    if (accounts.length === 0) {
      setScanError(
        'No accounts in this wallet to scan with. Add an account first.'
      );
      return;
    }
    setScanError(null);
    setResults([]);
    setSelections({});
    setVerified(false);
    setSaveError(null);
    setPhase('scanning');
    try {
      const discovered = await scanForUserMultisigs(
        accounts.map((a) => a.address)
      );
      setResults(discovered);
      setPhase('results');
    } catch (e) {
      setScanError((e as Error).message ?? 'Scan failed.');
      setPhase('idle');
    }
  };

  const toggleSelection = (address: string) => {
    setSelections((cur) => {
      if (cur[address]) {
        const { [address]: _, ...rest } = cur;
        return rest;
      }
      // Default nickname: derived from the multisig context (we don't
      // have any "claimed" name from the chain since this is purely
      // discovery). User can edit.
      return {
        ...cur,
        [address]: { nickname: '', labels: {} },
      };
    });
  };

  const updateSelectionNickname = (address: string, nickname: string) => {
    setSelections((cur) => {
      if (!cur[address]) return cur;
      return { ...cur, [address]: { ...cur[address], nickname } };
    });
  };

  const updateSelectionLabel = (
    address: string,
    signerAddress: string,
    label: string
  ) => {
    setSelections((cur) => {
      if (!cur[address]) return cur;
      return {
        ...cur,
        [address]: {
          ...cur[address],
          labels: { ...cur[address].labels, [signerAddress]: label },
        },
      };
    });
  };

  const selectedCount = Object.keys(selections).length;
  const canSave = selectedCount > 0 && verified && !saving;

  const handleImport = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const discovery of newDiscoveries) {
        const selection = selections[discovery.address];
        if (!selection) continue;
        const nickname =
          selection.nickname.trim() ||
          `Discovered multisig (${shortenAddress(discovery.address, { start: 6, end: 4 })})`;
        const signersWithLabels = discovery.signers.map((s) => ({
          address: s,
          label: selection.labels[s]?.trim() || undefined,
        }));
        const multisig = await addMultisig({
          threshold: discovery.threshold,
          signers: signersWithLabels,
          localName: nickname,
        });

        // Auto-add labeled cosigners to the address book, same logic
        // as the Path B import flow. Skip own accounts, skip already-
        // existing contacts, skip unlabeled signers.
        for (const signer of signersWithLabels) {
          if (!signer.label) continue;
          if (accounts.some((a) => a.address === signer.address)) continue;
          if (contacts.some((c) => c.address === signer.address)) continue;
          try {
            addContact(
              signer.address,
              signer.label,
              `Cosigner of ${multisig.localName}`
            );
          } catch {
            // Failed contact add doesn't block the import.
          }
        }
      }
      // If they imported a single multisig, drop them on its detail
      // screen. Otherwise just go back to the dashboard so they can
      // browse their newly-populated multisig list.
      const importedAddrs = Object.keys(selections);
      if (importedAddrs.length === 1) {
        navigate(`/multisig/${importedAddrs[0]}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setSaveError((err as Error).message);
      setSaving(false);
    }
  };

  // ---------- Render ----------

  return (
    <>
      <TopBar title="Scan chain" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
        {/* Intro / button */}
        {phase === 'idle' && (
          <>
            <div className="card text-xs text-ink-300 leading-relaxed space-y-1.5">
              <p>
                Find multisigs that any of your wallet accounts are
                signers of. The scan walks past on-chain multisig
                activity for each of your accounts, derives the multisig
                address locally, and shows you what's out there to
                selectively import.
              </p>
              <p className="text-ink-400">
                You'll still confirm with at least one cosigner
                out-of-band before importing — anyone can put your
                address into a multisig signer set on chain, and that
                alone is not proof of legitimacy.
              </p>
            </div>
            <button onClick={handleScan} className="btn-primary w-full">
              <Search size={16} strokeWidth={2} />
              Scan for multisigs
            </button>
            {scanError && (
              <div className="card border border-danger/30 bg-danger/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    strokeWidth={2}
                    className="text-danger mt-0.5 flex-shrink-0"
                  />
                  <p className="text-xs text-danger leading-snug">
                    {scanError}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {phase === 'scanning' && (
          <div className="card flex items-center gap-3 text-sm text-ink-300">
            <Loader2 size={16} className="animate-spin text-xx-500" />
            <span>
              Scanning chain history for your accounts… this may take a
              few seconds.
            </span>
          </div>
        )}

        {phase === 'results' && (
          <>
            <div className="card text-xs text-ink-300 leading-relaxed">
              {newDiscoveries.length === 0 ? (
                results.length === 0 ? (
                  <p>
                    No multisigs found involving any of your wallet
                    accounts. If you expected one, double-check that
                    you've added the right signer account to this
                    wallet.
                  </p>
                ) : (
                  <p>
                    Found {results.length} multisig
                    {results.length === 1 ? '' : 's'}, but
                    {results.length === 1 ? ' it ' : ' all '}already
                    {results.length === 1 ? ' is' : ' are'} in your
                    wallet. Nothing new to import.
                  </p>
                )
              ) : (
                <p>
                  Found{' '}
                  <span className="text-ink-100 font-medium">
                    {newDiscoveries.length} new multisig
                    {newDiscoveries.length === 1 ? '' : 's'}
                  </span>{' '}
                  involving your accounts. Pick which to import.
                </p>
              )}
            </div>

            {newDiscoveries.map((d) => (
              <DiscoveryCard
                key={d.address}
                discovery={d}
                accounts={accounts}
                selected={!!selections[d.address]}
                selection={selections[d.address]}
                onToggle={() => toggleSelection(d.address)}
                onNicknameChange={(n) =>
                  updateSelectionNickname(d.address, n)
                }
                onLabelChange={(signerAddr, label) =>
                  updateSelectionLabel(d.address, signerAddr, label)
                }
              />
            ))}

            {newDiscoveries.length > 0 && (
              <>
                {/* Verify gate — same as Path B import */}
                <div className="card border border-amber-500/30 bg-amber-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Key
                      size={14}
                      strokeWidth={2.25}
                      className="text-amber-400"
                    />
                    <p className="text-xs font-medium text-amber-200">
                      Verify before importing
                    </p>
                  </div>
                  <p className="text-xs text-ink-200 leading-relaxed">
                    Confirm out-of-band (voice, video, in person) with
                    a cosigner of each selected multisig that the
                    signer addresses below are who you think they are.
                    Discovering a multisig on chain is not proof it's
                    legitimate — anyone could have added your address
                    to a signer set.
                  </p>
                  <label className="flex items-start gap-2 mt-1 text-xs text-ink-200 leading-snug cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                      className="mt-0.5 w-3.5 h-3.5 accent-amber-500 flex-shrink-0"
                    />
                    <span>
                      I have verified the signers of each selected
                      multisig and want to import.
                    </span>
                  </label>
                </div>

                {saveError && (
                  <div className="card border border-danger/30 bg-danger/5">
                    <div className="flex items-start gap-2">
                      <X
                        size={14}
                        strokeWidth={2.25}
                        className="text-danger mt-0.5 flex-shrink-0"
                      />
                      <p className="text-xs text-danger leading-snug">
                        {saveError}
                      </p>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleImport}
                  disabled={!canSave}
                  className={clsx(
                    'btn-primary w-full',
                    !canSave && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Check size={16} strokeWidth={2} />
                  )}
                  {saving
                    ? 'Importing…'
                    : selectedCount === 0
                    ? 'Import (none selected)'
                    : `Import ${selectedCount} multisig${selectedCount === 1 ? '' : 's'}`}
                </button>
              </>
            )}

            <button
              onClick={handleScan}
              className="btn-secondary w-full mt-2"
              disabled={saving}
            >
              <Search size={14} strokeWidth={2} />
              Scan again
            </button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * One discovery row — checkbox + multisig summary. Expandable to show
 * per-signer label inputs and the nickname input when selected.
 */
function DiscoveryCard({
  discovery,
  accounts,
  selected,
  selection,
  onToggle,
  onNicknameChange,
  onLabelChange,
}: {
  discovery: DiscoveredMultisig;
  accounts: Array<{ address: string; name: string }>;
  selected: boolean;
  selection: { nickname: string; labels: Record<string, string> } | undefined;
  onToggle: () => void;
  onNicknameChange: (n: string) => void;
  onLabelChange: (signerAddress: string, label: string) => void;
}) {
  return (
    <div
      className={clsx(
        'card space-y-3',
        selected && 'border-xx-500/40 bg-xx-500/5'
      )}
    >
      {/* Header row: checkbox + address + threshold + activity badge */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 text-left"
      >
        <div
          className={clsx(
            'mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
            selected
              ? 'bg-xx-500 text-ink-950'
              : 'border border-ink-600'
          )}
        >
          {selected && <Check size={12} strokeWidth={2.5} />}
        </div>
        <AddressIcon
          address={discovery.address}
          size={32}
          copyOnTap={false}
        />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-xs text-ink-100 break-all leading-snug">
            {discovery.address}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-xx-500/10 text-xx-500 text-xs font-medium">
              <Users size={9} strokeWidth={2.25} />
              {discovery.threshold}-of-{discovery.signers.length}
            </span>
            <span className="text-xs uppercase tracking-wider text-ink-400">
              {discovery.activityCount} on-chain action
              {discovery.activityCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </button>

      {/* Signers (always shown when selected; collapsed when not) */}
      {selected && selection && (
        <>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Local nickname
            </p>
            <input
              type="text"
              value={selection.nickname}
              onChange={(e) => onNicknameChange(e.target.value)}
              placeholder="e.g. Foundation Operations"
              maxLength={64}
              className="input-base text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Signers ({discovery.signers.length})
              </p>
              <p className="text-xs uppercase tracking-wider text-ink-400">
                labeled = added to contacts
              </p>
            </div>
            {discovery.signers.map((addr) => {
              const ownAccount = accounts.find((a) => a.address === addr);
              return (
                <div key={addr} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AddressIcon address={addr} size={20} copyOnTap={false} />
                    <div className="flex-1 min-w-0">
                      {/* AddressLabel surfaces a known name (own account /
                          contact / known multisig) paired with the
                          truncated fragment, else just the truncated
                          fragment. */}
                      <AddressLabel address={addr} className="text-xs" />
                    </div>
                    {ownAccount && (
                      <span className="text-xs uppercase tracking-wider text-xx-500 font-medium flex-shrink-0">
                        you
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={selection.labels[addr] ?? ownAccount?.name ?? ''}
                    onChange={(e) => onLabelChange(addr, e.target.value)}
                    placeholder="Optional label"
                    maxLength={64}
                    className="input-base text-xs"
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
