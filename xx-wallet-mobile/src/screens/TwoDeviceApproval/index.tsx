/**
 * TwoDeviceApproval — guided setup for "two-device approval" (multisig as a
 * 2-factor on funds). Opinionated wrapper over the existing multisig
 * primitives: it always builds a 2-of-3 and frames the three signers as
 * "this device", "a second device", and "an offline backup".
 *
 * The three keys, and why the layout is what it is:
 *   - signer 1: an account already on THIS device.
 *   - signer 2: an account on the user's SECOND device — brought in by
 *     scanning/pasting its address (its key never comes here).
 *   - signer 3: an OFFLINE backup we generate in-flow. Its recovery phrase
 *     is shown once for the user to store offline, and its private key is
 *     NEVER persisted on this device. That last point is load-bearing: if
 *     the backup key lived here too, this one device would hold 2 of 3 keys
 *     and could meet the threshold alone — defeating the whole point.
 *
 * On completion we hand off to the existing MultisigDetail / Propose /
 * Approve / Share screens unchanged.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Smartphone,
  HardDrive,
  KeyRound,
  Atom,
  Eye,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  QrCode,
  ArrowRight,
} from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressIcon, QrScanner } from '@/components/ui';
import { useAccountsStore, useMultisigsStore } from '@/store';
import { xxKeyring, generateSleeveAccount, initSleeve } from '@/keyring';
import { deriveMultisigAddress, isValidXxAddress, shortenAddress } from '@/utils';
import { copyToClipboard } from '@/utils/clipboard';

type Step =
  | 'intro'
  | 'thisDevice'
  | 'secondDevice'
  | 'backupIntro'
  | 'backupExisting'
  | 'backupGen'
  | 'backupReveal'
  | 'review'
  | 'done';

interface BackupKey {
  address: string;
  /** Present only when the backup was generated in-flow; absent when the
   *  user supplied the address of a key they already hold. */
  quantumMnemonic?: string;
  standardMnemonic?: string;
}

export function TwoDeviceApproval() {
  const navigate = useNavigate();
  const { accounts, activeAddress } = useAccountsStore();
  const addMultisig = useMultisigsStore((s) => s.addMultisig);
  const getMultisig = useMultisigsStore((s) => s.getMultisig);

  const [step, setStep] = useState<Step>('intro');

  // signer 1 — an account on THIS device
  const [thisDevice, setThisDevice] = useState<string>(
    activeAddress ?? accounts[0]?.address ?? ''
  );

  // signer 2 — an address from the user's SECOND device
  const [secondDevice, setSecondDevice] = useState('');
  const [secondError, setSecondError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // signer 3 — offline backup. Either generated here (private key NOT
  // persisted) or an existing cold key the user supplies by address.
  const [backup, setBackup] = useState<BackupKey | null>(null);
  const [backupRevealed, setBackupRevealed] = useState(false);
  const [backupAck, setBackupAck] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'quantum' | 'standard' | null>(null);
  // "Use existing key" path
  const [backupInput, setBackupInput] = useState('');
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupScannerOpen, setBackupScannerOpen] = useState(false);

  const [name, setName] = useState('Protected account');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdAddress, setCreatedAddress] = useState<string | null>(null);

  // Pre-warm the Sleeve WASM while the user reads the backup intro, so the
  // generate step doesn't sit on a 3.3 MB fetch.
  useEffect(() => {
    if (step === 'backupIntro') initSleeve().catch(() => {});
  }, [step]);

  // Generate the offline backup key on entering backupGen. generateSleeveAccount
  // does NOT persist; we derive the address and keep only that.
  useEffect(() => {
    if (step === 'backupGen' && !backup) {
      (async () => {
        try {
          const r = await generateSleeveAccount();
          const address = xxKeyring.addressFromMnemonic(r.standardMnemonic);
          setBackup({
            quantumMnemonic: r.quantumMnemonic,
            standardMnemonic: r.standardMnemonic,
            address,
          });
          setStep('backupReveal');
        } catch (err) {
          setGenError((err as Error).message);
        }
      })();
    }
  }, [step, backup]);

  const signers = useMemo(
    () => (backup ? [thisDevice, secondDevice, backup.address] : []),
    [thisDevice, secondDevice, backup]
  );

  const derivedAddress = useMemo(() => {
    if (signers.length !== 3) return null;
    if (new Set(signers).size !== 3) return null;
    try {
      return deriveMultisigAddress(2, signers);
    } catch {
      return null;
    }
  }, [signers]);

  const existing = derivedAddress ? getMultisig(derivedAddress) : undefined;

  const thisDeviceAccount = accounts.find((a) => a.address === thisDevice);

  const handleSecondDeviceContinue = () => {
    const trimmed = secondDevice.trim();
    if (!isValidXxAddress(trimmed)) {
      setSecondError('Not a valid xx network address — they start with "6".');
      return;
    }
    if (trimmed === thisDevice) {
      setSecondError(
        "That's this device's account. The second key must be a different account, on your other device."
      );
      return;
    }
    if (accounts.some((a) => a.address === trimmed)) {
      setSecondError(
        'That account is also on this device. For real two-device protection the second key must live on a different device.'
      );
      return;
    }
    setSecondDevice(trimmed);
    setSecondError(null);
    setStep('backupIntro');
  };

  // "Use a key I already have" — only the address is taken. Same anti-footgun
  // guards as the second-device step, plus: must differ from BOTH devices, and
  // must NOT be a key on this device (else this device holds 2 of 3 keys).
  const handleBackupExistingContinue = () => {
    const trimmed = backupInput.trim();
    if (!isValidXxAddress(trimmed)) {
      setBackupError('Not a valid xx network address — they start with "6".');
      return;
    }
    if (trimmed === thisDevice || trimmed === secondDevice) {
      setBackupError(
        'That address is already one of your two devices. The backup must be a third, separate key.'
      );
      return;
    }
    if (accounts.some((a) => a.address === trimmed)) {
      setBackupError(
        'That key is on this device. The backup must be one you keep offline — otherwise this device would hold two of the three keys.'
      );
      return;
    }
    setBackup({ address: trimmed });
    setBackupError(null);
    setStep('review');
  };

  const handleCopy = async (kind: 'quantum' | 'standard') => {
    if (!backup) return;
    const text =
      kind === 'quantum' ? backup.quantumMnemonic : backup.standardMnemonic;
    if (!text) return;
    if (await copyToClipboard(text)) {
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    }
  };

  const handleCreate = async () => {
    if (!derivedAddress || !backup || existing || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const m = await addMultisig({
        threshold: 2,
        signers: [
          { address: thisDevice, label: 'This device' },
          { address: secondDevice, label: 'Second device' },
          { address: backup.address, label: 'Offline backup' },
        ],
        localName: name.trim() || 'Protected account',
        preset: 'two-device',
      });
      setCreatedAddress(m.address);
      setStep('done');
    } catch (err) {
      setSubmitError(
        (err as Error).message ?? 'Failed to create the protected account.'
      );
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title="Two-device approval" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5 pb-24">
        {step === 'intro' && (
          <>
            <div className="flex flex-col items-center text-center gap-3 pt-2">
              <div className="w-14 h-14 rounded-2xl bg-xx-500/10 border border-xx-500/30 flex items-center justify-center">
                <ShieldCheck size={26} className="text-xx-500" strokeWidth={1.75} />
              </div>
              <h2 className="font-display font-semibold text-xl tracking-tight text-ink-100">
                Require two devices to spend
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed">
                We'll create a protected account secured by three keys — this
                device, a second device, and an offline backup. Any{' '}
                <span className="text-ink-100 font-medium">two</span> must
                approve before funds move, so a single lost or compromised
                device can't spend on its own.
              </p>
            </div>

            <div className="card space-y-3">
              <StepLine
                icon={<Smartphone size={16} className="text-ink-300" />}
                title="This device"
                body="An account you already have here."
              />
              <StepLine
                icon={<QrCode size={16} className="text-ink-300" />}
                title="A second device"
                body="Scan its address from your other phone or tablet — its key stays on that device."
              />
              <StepLine
                icon={<HardDrive size={16} className="text-ink-300" />}
                title="An offline backup"
                body="A fresh key we generate, or a cold key you already have. Kept offline — your safety net if a device is lost."
              />
            </div>

            <p className="text-xs text-ink-400 leading-relaxed">
              Because any two of the three can approve, losing one device
              doesn't lock you out — you recover with your remaining device and
              the offline backup. This is on-chain protection enforced by the
              network, not just an in-app prompt.
            </p>

            <button
              onClick={() => setStep('thisDevice')}
              className="btn-primary w-full"
            >
              Get started
              <ArrowRight size={16} strokeWidth={2} />
            </button>
          </>
        )}

        {step === 'thisDevice' && (
          <>
            <SectionHeader
              icon={<Smartphone size={18} className="text-xx-500" />}
              title="This device's key"
              body="Pick which of your accounts on this device is the first signer."
            />

            {accounts.length === 0 ? (
              <p className="text-sm text-ink-300">
                You need an account on this device first.
              </p>
            ) : (
              <div className="card space-y-1.5">
                {accounts.map((acct) => {
                  const selected = acct.address === thisDevice;
                  return (
                    <button
                      key={acct.address}
                      type="button"
                      onClick={() => setThisDevice(acct.address)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors',
                        selected
                          ? 'bg-xx-500/10 border border-xx-500/30'
                          : 'bg-ink-900 border border-ink-700 active:bg-ink-800'
                      )}
                    >
                      <AddressIcon address={acct.address} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-100 truncate">
                          {acct.name}
                        </p>
                        <p className="font-mono text-xs text-ink-400 truncate">
                          {shortenAddress(acct.address, { start: 8, end: 6 })}
                        </p>
                      </div>
                      {selected && (
                        <div className="w-5 h-5 rounded-full bg-xx-500 flex items-center justify-center flex-shrink-0">
                          <Check size={12} strokeWidth={2.5} className="text-ink-950" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setStep('secondDevice')}
              disabled={!thisDevice}
              className="btn-primary w-full"
            >
              Continue
              <ArrowRight size={16} strokeWidth={2} />
            </button>
          </>
        )}

        {step === 'secondDevice' && (
          <>
            <SectionHeader
              icon={<QrCode size={18} className="text-xx-500" />}
              title="Your second device"
              body="On your other phone or tablet, open xx Wallet, create or open an account, and show its receive QR. Scan it here — only its address comes over, never its key."
            />

            <button
              onClick={() => setScannerOpen(true)}
              className="btn-secondary w-full"
            >
              <QrCode size={16} strokeWidth={2} />
              Scan the second device
            </button>

            <div className="card space-y-2">
              <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
                Or paste its address
              </label>
              <textarea
                value={secondDevice}
                onChange={(e) => {
                  setSecondDevice(e.target.value);
                  setSecondError(null);
                }}
                placeholder="6…"
                className="input-base min-h-[80px] py-3 font-mono text-sm resize-none"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {secondError && (
                <p className="text-xs text-danger leading-snug">{secondError}</p>
              )}
            </div>

            <button
              onClick={handleSecondDeviceContinue}
              disabled={!secondDevice.trim()}
              className="btn-primary w-full"
            >
              Continue
              <ArrowRight size={16} strokeWidth={2} />
            </button>

            {scannerOpen && (
              <QrScanner
                onScan={(result) => {
                  setSecondDevice(result.trim());
                  setSecondError(null);
                  setScannerOpen(false);
                }}
                onClose={() => setScannerOpen(false)}
              />
            )}
          </>
        )}

        {step === 'backupIntro' && (
          <>
            <SectionHeader
              icon={<HardDrive size={18} className="text-xx-500" />}
              title="Your offline backup key"
              body="The third key — your safety net if a device is lost. Generate a fresh one, or use a cold key you already have."
            />

            <button
              onClick={() => setStep('backupGen')}
              className="w-full flex items-start gap-3 p-3 rounded-2xl bg-xx-500/10 border border-xx-500/30 active:bg-xx-500/20 text-left"
            >
              <div className="w-9 h-9 rounded-full bg-ink-900 border border-xx-500/40 flex items-center justify-center flex-shrink-0">
                <HardDrive size={16} strokeWidth={2} className="text-xx-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-100">
                  Generate a new backup key
                </p>
                <p className="text-sm text-ink-300 leading-snug mt-0.5">
                  We create it and show its recovery phrase once — write it down
                  and store it offline. Best if you don't already have a cold
                  key.
                </p>
              </div>
            </button>

            <button
              onClick={() => setStep('backupExisting')}
              className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
            >
              <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
                <KeyRound size={16} strokeWidth={2} className="text-ink-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-100">
                  Use a key I already have
                </p>
                <p className="text-sm text-ink-300 leading-snug mt-0.5">
                  Enter the address of an existing cold key — a hardware wallet,
                  paper wallet, or an offline device. Only its address is used.
                </p>
              </div>
            </button>

            <p className="text-xs text-ink-400 leading-relaxed">
              Either way, the backup must stay{' '}
              <span className="text-ink-200 font-medium">offline</span> — not on
              either of your two devices. If it shared a device with another
              signer, that device would hold two of the three keys and could
              spend on its own.
            </p>
          </>
        )}

        {step === 'backupExisting' && (
          <>
            <SectionHeader
              icon={<KeyRound size={18} className="text-xx-500" />}
              title="Your existing backup key"
              body="Enter or scan the address of a cold key you control. Only its address is used — never its keys or recovery phrase."
            />

            <button
              onClick={() => setBackupScannerOpen(true)}
              className="btn-secondary w-full"
            >
              <QrCode size={16} strokeWidth={2} />
              Scan the backup key
            </button>

            <div className="card space-y-2">
              <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
                Or paste its address
              </label>
              <textarea
                value={backupInput}
                onChange={(e) => {
                  setBackupInput(e.target.value);
                  setBackupError(null);
                }}
                placeholder="6…"
                className="input-base min-h-[80px] py-3 font-mono text-sm resize-none"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {backupError && (
                <p className="text-xs text-danger leading-snug">{backupError}</p>
              )}
            </div>

            <p className="text-xs text-ink-400 leading-relaxed">
              This must be a third, separate key — not either of your two
              devices, and not a key stored on this phone.
            </p>

            <button
              onClick={handleBackupExistingContinue}
              disabled={!backupInput.trim()}
              className="btn-primary w-full"
            >
              Continue
              <ArrowRight size={16} strokeWidth={2} />
            </button>

            {backupScannerOpen && (
              <QrScanner
                onScan={(result) => {
                  setBackupInput(result.trim());
                  setBackupError(null);
                  setBackupScannerOpen(false);
                }}
                onClose={() => setBackupScannerOpen(false)}
              />
            )}
          </>
        )}

        {step === 'backupGen' && (
          <div className="py-12 flex flex-col items-center text-center gap-5">
            {!genError ? (
              <>
                <Loader2 size={40} className="text-xx-500 animate-spin" />
                <div className="space-y-1">
                  <p className="font-display font-medium text-lg text-ink-100">
                    Generating your backup key
                  </p>
                  <p className="text-sm text-ink-400 max-w-xs leading-relaxed">
                    Producing the recovery phrases for your offline safety net.
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle size={40} className="text-danger" />
                <div className="space-y-1">
                  <p className="font-display font-medium text-lg text-ink-100">
                    Generation failed
                  </p>
                  <p className="text-sm text-ink-400 max-w-xs leading-relaxed">
                    {genError}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setGenError(null);
                    setStep('backupIntro');
                  }}
                  className="btn-secondary"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}

        {step === 'backupReveal' && backup && (
          <>
            <SectionHeader
              icon={<HardDrive size={18} className="text-xx-500" />}
              title="Back up these phrases"
              body="Write both down, in order, and store them offline. You'll need them to recover if you lose a device."
            />

            <PhraseBlock
              title="Quantum recovery phrase"
              icon={<Atom size={14} className="text-xx-cyan" strokeWidth={2.25} />}
              accent="text-xx-cyan"
              accentBg="bg-xx-cyan/10"
              accentBorder="border-xx-cyan/40"
              mnemonic={backup.quantumMnemonic ?? ''}
              revealed={backupRevealed}
              onReveal={() => setBackupRevealed(true)}
              onCopy={() => handleCopy('quantum')}
              copied={copied === 'quantum'}
            />
            <PhraseBlock
              title="Standard recovery phrase"
              icon={<KeyRound size={14} className="text-xx-500" strokeWidth={2.25} />}
              accent="text-xx-500"
              accentBg="bg-xx-500/10"
              accentBorder="border-xx-500/40"
              mnemonic={backup.standardMnemonic ?? ''}
              revealed={backupRevealed}
              onReveal={() => setBackupRevealed(true)}
              onCopy={() => handleCopy('standard')}
              copied={copied === 'standard'}
            />

            <label className="flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700/70 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={backupAck}
                onChange={(e) => setBackupAck(e.target.checked)}
                className="sr-only"
              />
              <div
                className={clsx(
                  'flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors',
                  backupAck ? 'bg-xx-500 border-xx-500' : 'bg-transparent border-ink-600'
                )}
              >
                {backupAck && <Check size={14} className="text-ink-950" strokeWidth={3} />}
              </div>
              <span className="text-xs text-ink-200 leading-relaxed flex-1">
                I've written down both phrases and stored them offline, not on
                this phone.
              </span>
            </label>

            <button
              onClick={() => setStep('review')}
              disabled={!backupRevealed || !backupAck}
              className="btn-primary w-full"
            >
              Continue
              <ArrowRight size={16} strokeWidth={2} />
            </button>
          </>
        )}

        {step === 'review' && backup && (
          <>
            <SectionHeader
              icon={<ShieldCheck size={18} className="text-xx-500" />}
              title="Review & create"
              body="Any 2 of these 3 keys will be required to spend."
            />

            <div className="card space-y-2">
              <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                className="input-base"
                placeholder="Protected account"
              />
              <p className="text-xs text-ink-400 leading-relaxed">
                Local label, only visible to you.
              </p>
            </div>

            <div className="card space-y-2.5">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Signers (2 of 3 required)
              </p>
              <SignerRow
                icon={<Smartphone size={15} className="text-ink-300" />}
                label="This device"
                sublabel={thisDeviceAccount?.name}
                address={thisDevice}
              />
              <SignerRow
                icon={<QrCode size={15} className="text-ink-300" />}
                label="Second device"
                address={secondDevice}
              />
              <SignerRow
                icon={<HardDrive size={15} className="text-ink-300" />}
                label="Offline backup"
                address={backup.address}
              />
            </div>

            <div className="card space-y-2">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Protected account address
              </p>
              {derivedAddress ? (
                <p className="font-mono text-xs text-ink-100 break-all leading-snug select-all">
                  {derivedAddress}
                </p>
              ) : (
                <p className="text-xs text-danger">
                  Couldn't derive the address — the three signers must be
                  distinct.
                </p>
              )}
              {existing && (
                <div className="flex items-start gap-2 mt-1 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle
                    size={14}
                    className="text-amber-400 mt-0.5 flex-shrink-0"
                  />
                  <p className="text-xs text-amber-200 leading-snug">
                    This account already exists in your wallet as
                    <span className="font-medium"> "{existing.localName}"</span>.
                  </p>
                </div>
              )}
            </div>

            {submitError && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-danger/10 border border-danger/30">
                <AlertTriangle size={14} className="text-danger mt-0.5 flex-shrink-0" />
                <p className="text-xs text-danger leading-snug">{submitError}</p>
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={!derivedAddress || !!existing || submitting}
              className="btn-primary w-full"
            >
              <ShieldCheck size={16} strokeWidth={2} />
              {submitting ? 'Creating…' : 'Create protected account'}
            </button>
          </>
        )}

        {step === 'done' && createdAddress && (
          <>
            <div className="flex flex-col items-center text-center gap-3 pt-4">
              <div className="w-14 h-14 rounded-2xl bg-xx-500/10 border border-xx-500/30 flex items-center justify-center">
                <Check size={28} className="text-xx-500" strokeWidth={2.25} />
              </div>
              <h2 className="font-display font-semibold text-xl tracking-tight text-ink-100">
                Protected account ready
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed">
                Move funds into it to protect them. Spending now needs approval
                from a second device — propose on one, approve on the other.
              </p>
              <p className="text-xs text-ink-400 leading-relaxed">
                One more step: share this account's config with your second
                device so it shows up there too. On your other device — and on
                block explorers — this account appears as what it really is, a
                2-of-3 multisig. The protection is enforced by the chain, not
                by this app.
              </p>
            </div>

            <button
              onClick={() =>
                navigate(`/multisig/${createdAddress}`, {
                  replace: true,
                  state: { openExport: true },
                })
              }
              className="btn-primary w-full"
            >
              Set up your second device
              <ArrowRight size={16} strokeWidth={2} />
            </button>
            <button
              onClick={() => navigate(`/multisig/${createdAddress}`, { replace: true })}
              className="btn-secondary w-full"
            >
              View protected account
            </button>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="btn-ghost w-full text-ink-300"
            >
              Back to wallet
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components

function SectionHeader({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-display font-medium text-lg text-ink-100">{title}</h2>
      </div>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function StepLine({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-100">{title}</p>
        <p className="text-xs text-ink-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function SignerRow({
  icon,
  label,
  sublabel,
  address,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  address: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <AddressIcon address={address} size={28} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {icon}
          <p className="text-sm font-medium text-ink-100 truncate">
            {label}
            {sublabel ? (
              <span className="text-ink-400 font-normal"> · {sublabel}</span>
            ) : null}
          </p>
        </div>
        <p className="font-mono text-xs text-ink-400 truncate">
          {shortenAddress(address, { start: 8, end: 6 })}
        </p>
      </div>
    </div>
  );
}

function PhraseBlock({
  title,
  icon,
  accent,
  accentBg,
  accentBorder,
  mnemonic,
  revealed,
  onReveal,
  onCopy,
  copied,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  accentBg: string;
  accentBorder: string;
  mnemonic: string;
  revealed: boolean;
  onReveal: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className={clsx('card space-y-3 border', accentBorder)}>
      <div className="flex items-center gap-2">
        {icon}
        <p className={clsx('text-xs uppercase tracking-wider font-medium', accent)}>
          {title}
        </p>
      </div>
      <div className="relative">
        <div
          className={clsx(
            'grid grid-cols-2 gap-2 transition-all',
            !revealed && 'blur-md select-none pointer-events-none'
          )}
        >
          {mnemonic.split(' ').map((word, i) => (
            <div
              key={i}
              className={clsx('flex items-center gap-2 p-2 rounded-lg', accentBg)}
            >
              <span className="text-ink-400 text-xs font-mono w-5 text-right">
                {i + 1}
              </span>
              <span className="font-mono text-sm text-ink-100">{word}</span>
            </div>
          ))}
        </div>
        {!revealed && (
          <button
            onClick={onReveal}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="btn-secondary">
              <Eye size={18} />
              Tap to reveal
            </span>
          </button>
        )}
      </div>
      {revealed && (
        <button onClick={onCopy} className="btn-ghost w-full text-ink-300">
          {copied ? (
            <>
              <Check size={16} className="text-xx-500" />
              Copied
            </>
          ) : (
            <>
              <Copy size={16} />
              Copy to clipboard
            </>
          )}
        </button>
      )}
    </div>
  );
}
