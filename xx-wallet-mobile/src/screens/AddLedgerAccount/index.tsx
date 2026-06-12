/**
 * AddLedgerAccount — connect a Ledger and add one of its accounts.
 *
 * Flow: connect (user gesture opens the WebHID picker) → pick an account
 * from the device's derivation sequence → confirm the address ON THE
 * DEVICE screen → name it → saved as a keystore-free account record.
 *
 * Derivation follows the Ledger Live convention: the ACCOUNT slot of
 * m/44'/1955'/account'/0'/0' increments per account, so the list here
 * matches what Ledger Live and polkadot{.js} apps show for the same
 * device.
 *
 * The on-device confirmation step is not ceremony — it's the only proof
 * that the address the wallet is about to store is the one the device
 * actually controls (a compromised browser could lie about the silent
 * read; it can't fake the device screen).
 *
 * Reached only behind isLedgerSupported() gates, but the screen also
 * self-checks so a direct deep-link on iOS gets an explanation instead
 * of a dead connect button.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Loader2,
  Usb,
} from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressIcon } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { xxKeyring } from '@/keyring';
import {
  getLedgerAddress,
  getLedgerSession,
  isLedgerSupported,
  type LedgerSlots,
} from '@/ledger';
import { useBalance } from '@/hooks';
import { formatBalance } from '@/utils/format';
import { shortenAddress } from '@/utils/address';
import { XX_SYMBOL } from '@/api';

type Step = 'connect' | 'pick' | 'confirm' | 'name';

interface Candidate {
  slots: LedgerSlots;
  address: string;
}

const BATCH_SIZE = 5;

export function AddLedgerAccount() {
  const navigate = useNavigate();
  const { accounts, setActive } = useAccountsStore();
  const refresh = useAccountsStore((s) => s.refresh);

  const [step, setStep] = useState<Step>('connect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const supported = isLedgerSupported();

  /** Read the next BATCH_SIZE addresses (silent, no device prompts). */
  const loadCandidates = async (from: number) => {
    const next: Candidate[] = [];
    for (let i = from; i < from + BATCH_SIZE; i++) {
      const slots = { account: i, change: 0, index: 0 };
      const { address } = await getLedgerAddress(slots, false);
      next.push({ slots, address });
    }
    setCandidates((cur) => [...cur, ...next]);
  };

  const handleConnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await getLedgerSession();
      setAppVersion(session.appVersion);
      await loadCandidates(0);
      setStep('pick');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleShowMore = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await loadCandidates(candidates.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePick = (c: Candidate) => {
    setChosen(c);
    setConfirmed(false);
    setError(null);
    setStep('confirm');
  };

  const handleDeviceConfirm = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { address } = await getLedgerAddress(chosen.slots, true);
      if (address !== chosen.address) {
        // Should be impossible — same slots, same device. If it ever
        // fires, something between read and confirm changed; refuse.
        throw new Error(
          'The device showed a different address than was read earlier — refusing. Reconnect and try again.'
        );
      }
      setConfirmed(true);
      setName(`Ledger ${chosen.slots.account + 1}`);
      setStep('name');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (!chosen || !confirmed) return;
    setSaveError(null);
    try {
      const record = xxKeyring.addLedgerAccount({
        address: chosen.address,
        name,
        ledger: chosen.slots,
      });
      refresh();
      setActive(record.address);
      navigate(`/account/${record.address}`, { replace: true });
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  return (
    <>
      <TopBar title="Connect Ledger" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5 pb-24">
        {!supported && (
          <div className="card border border-warning/30 bg-warning/5 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-warning" />
              <p className="text-xs font-medium text-warning">
                Not available in this browser
              </p>
            </div>
            <p className="text-xs text-ink-200 leading-relaxed">
              Connecting a Ledger needs WebHID, which exists in Chromium
              browsers on desktop and Android — not on iOS or Firefox.
              Your Ledger accounts still work from a supported browser on
              another device.
            </p>
          </div>
        )}

        {supported && step === 'connect' && (
          <>
            <div className="flex flex-col items-center text-center gap-3 pt-2">
              <div className="w-14 h-14 rounded-2xl bg-xx-500/10 border border-xx-500/30 flex items-center justify-center">
                <Usb size={26} className="text-xx-500" strokeWidth={1.75} />
              </div>
              <h2 className="font-display font-semibold text-xl tracking-tight text-ink-100">
                Add a Ledger account
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed">
                The private key stays on the Ledger and never enters this
                browser. Every transaction is shown on the device screen
                and signed only when you physically confirm it.
              </p>
            </div>

            <div className="card text-xs text-ink-300 leading-relaxed space-y-1.5">
              <p className="text-ink-200 font-medium">Before connecting:</p>
              <ul className="list-disc pl-4 space-y-1 text-ink-300">
                <li>Plug the Ledger in via USB and unlock it.</li>
                <li>
                  Open the <span className="text-ink-100">xx network</span>{' '}
                  app on the device (install it via Ledger Live if needed).
                </li>
                <li>Close Ledger Live — it blocks the browser's access.</li>
              </ul>
            </div>

            {error && (
              <div className="card border border-danger/30 bg-danger/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    className="text-danger mt-0.5 flex-shrink-0"
                  />
                  <p className="text-xs text-danger leading-snug">{error}</p>
                </div>
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={busy}
              className="btn-primary w-full"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Usb size={16} strokeWidth={2} />
              )}
              {busy ? 'Connecting…' : 'Connect Ledger'}
            </button>
          </>
        )}

        {supported && step === 'pick' && (
          <>
            <div className="space-y-1.5">
              <h2 className="font-display font-medium text-lg text-ink-100">
                Pick an account
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed">
                These are your Ledger's xx network accounts, in the same
                order Ledger Live shows them.
                {appVersion && (
                  <span className="text-ink-400"> xx app v{appVersion}.</span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              {candidates.map((c) => {
                const already = accounts.some((a) => a.address === c.address);
                return (
                  <CandidateRow
                    key={c.address}
                    candidate={c}
                    alreadyAdded={already}
                    onPick={() => handlePick(c)}
                  />
                );
              })}
            </div>

            {error && (
              <div className="card border border-danger/30 bg-danger/5">
                <p className="text-xs text-danger leading-snug">{error}</p>
              </div>
            )}

            <button
              onClick={handleShowMore}
              disabled={busy}
              className="btn-secondary w-full"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              {busy ? 'Reading…' : `Show ${BATCH_SIZE} more`}
            </button>
          </>
        )}

        {supported && step === 'confirm' && chosen && (
          <>
            <div className="space-y-1.5">
              <h2 className="font-display font-medium text-lg text-ink-100">
                Confirm on your Ledger
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed">
                The device will now show this address. Check it matches —
                approve on the device only if every character agrees with
                what you see here.
              </p>
            </div>

            <div className="card space-y-3">
              <div className="flex items-center gap-3">
                <AddressIcon address={chosen.address} size={36} />
                <p className="font-mono text-xs text-ink-100 break-all leading-snug">
                  {chosen.address}
                </p>
              </div>
              <p className="text-xs text-ink-400">
                Derivation: account #{chosen.slots.account + 1} (m/44'/1955'/
                {chosen.slots.account}'/0'/0')
              </p>
            </div>

            {error && (
              <div className="card border border-danger/30 bg-danger/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    className="text-danger mt-0.5 flex-shrink-0"
                  />
                  <p className="text-xs text-danger leading-snug">{error}</p>
                </div>
              </div>
            )}

            <button
              onClick={handleDeviceConfirm}
              disabled={busy}
              className="btn-primary w-full"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Usb size={16} strokeWidth={2} />
              )}
              {busy ? 'Check the device…' : 'Show it on the device'}
            </button>
            <button
              onClick={() => setStep('pick')}
              disabled={busy}
              className="btn-ghost w-full text-ink-300"
            >
              Back to the list
            </button>
          </>
        )}

        {supported && step === 'name' && chosen && confirmed && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Check size={18} className="text-xx-500" strokeWidth={2.25} />
                <h2 className="font-display font-medium text-lg text-ink-100">
                  Address confirmed
                </h2>
              </div>
              <p className="text-sm text-ink-300 leading-relaxed">
                Name the account and you're done. There's no recovery
                phrase to write down here — the key lives on the Ledger,
                protected by the device's own recovery setup.
              </p>
            </div>

            <div className="card space-y-2">
              <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                className="input-base"
                placeholder="e.g. Ledger savings"
              />
            </div>

            {saveError && (
              <div className="card border border-danger/30 bg-danger/5">
                <p className="text-xs text-danger leading-snug">{saveError}</p>
              </div>
            )}

            <button onClick={handleSave} className="btn-primary w-full">
              Add account
              <ArrowRight size={16} strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** One derivation candidate — identicon, address, live balance. */
function CandidateRow({
  candidate,
  alreadyAdded,
  onPick,
}: {
  candidate: Candidate;
  alreadyAdded: boolean;
  onPick: () => void;
}) {
  const { balance } = useBalance(candidate.address);
  return (
    <button
      onClick={onPick}
      disabled={alreadyAdded}
      className={clsx(
        'w-full flex items-center gap-3 p-3 rounded-2xl border text-left',
        alreadyAdded
          ? 'bg-ink-900 border-ink-800 opacity-60'
          : 'bg-ink-800 border-ink-700/50 active:bg-ink-700'
      )}
    >
      <AddressIcon address={candidate.address} size={32} copyOnTap={false} />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs text-ink-100 truncate">
          {shortenAddress(candidate.address, { start: 10, end: 8 })}
        </p>
        <p className="text-xs text-ink-400 mt-0.5">
          Account #{candidate.slots.account + 1}
          <span className="text-ink-600"> · </span>
          <span className="numeric">
            {balance ? formatBalance(balance.free, { decimals: 4 }) : '—'}{' '}
            {XX_SYMBOL}
          </span>
        </p>
      </div>
      {alreadyAdded && (
        <span className="text-xs uppercase tracking-wider text-ink-400 flex-shrink-0">
          added
        </span>
      )}
    </button>
  );
}
