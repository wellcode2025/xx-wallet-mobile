/**
 * MultisigImport — Path B import flow for adding a multisig from a
 * shared config JSON.
 *
 * Two phases:
 *   1. Input — pick how to load the config (file / QR / paste). All
 *      three paths feed parseMultisigConfig, which does schema +
 *      address-derivation verification before the user sees anything.
 *   2. Review — once the config validates, show the multisig details
 *      (with the locally-re-derived address as proof of integrity),
 *      let the user pick a local nickname + per-signer labels, gate
 *      Save behind an explicit "I verified the signers out-of-band"
 *      acknowledgement.
 *
 * Per design doc §6.6 Path B. Allows import of multisigs the user
 * isn't a signer of (read-only watching is a legitimate use case;
 * the wallet shows them the multisig but propose/approve actions
 * stay disabled because no eligible-signer accounts intersect with
 * the multisig's signer set).
 */

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Clipboard,
  Eye,
  FileJson,
  Key,
  ScanLine,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel, QrScanner } from '@/components/ui';
import { useAccountsStore, useAddressBook, useMultisigsStore } from '@/store';
import {
  deriveMultisigAddress,
  extractAddressFromFilename,
  parseLegacyMultisigSigners,
  parseMultisigConfig,
  shortenAddress,
  type MultisigConfig,
} from '@/utils';

type Phase = 'input' | 'review' | 'legacy-review';

export function MultisigImport() {
  const navigate = useNavigate();
  const { accounts } = useAccountsStore();
  const { contacts, addContact } = useAddressBook();
  const addMultisig = useMultisigsStore((s) => s.addMultisig);
  const existingMultisigs = useMultisigsStore((s) => s.multisigs);

  const [phase, setPhase] = useState<Phase>('input');
  const [parsed, setParsed] = useState<MultisigConfig | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Legacy-format state (official xx wallet's flat-array exports). The
  // legacy file gives us only the signer list; the user has to enter
  // the threshold themselves before we can derive the multisig address.
  const [legacySigners, setLegacySigners] = useState<string[] | null>(null);
  const [legacyThreshold, setLegacyThreshold] = useState<number>(2);
  // Filename hint: when the user opens an official-wallet export, the
  // multisig's address is encoded in the filename (e.g.
  // `<name>_6Zihn...HnU8M_<timestamp>.json`). We pull it out and use
  // it as an INFORMATIONAL cross-check after the user picks a
  // threshold — if the locally-derived address matches, that's a
  // green light. Not enforced (filenames can be renamed); just
  // confidence-building.
  const [legacyFilenameAddress, setLegacyFilenameAddress] = useState<
    string | null
  >(null);
  const [legacyFilenameName, setLegacyFilenameName] = useState<string | null>(
    null
  );

  // Local label state for the review phase. Keyed by signer address
  // so we keep them aligned even if we re-load a different config.
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [localName, setLocalName] = useState<string>('');
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Input-phase widgets state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState('');

  /** Take a raw string (file contents, scanned QR text, pasted JSON)
   *  and route to whichever review phase fits its shape:
   *    - Our richer format (parseMultisigConfig succeeds) → 'review'
   *    - Official xx wallet's flat-array format (parseLegacyMultisigSigners
   *      succeeds) → 'legacy-review' (user has to enter threshold)
   *    - Otherwise → surface the parse error from our format
   *
   * `legacyName` is passed as an explicit argument (rather than read
   * from state) so the file path can supply the freshly-extracted
   * filename hint without depending on the stale state closure. The
   * paste / QR paths pass null. */
  const tryLoad = (raw: string, legacyName: string | null = null) => {
    setParseError(null);

    // Strategy 1: our richer format.
    const result = parseMultisigConfig(raw);
    if (result.ok) {
      if (
        existingMultisigs.some(
          (m) => m.address === result.config.multisigAddress
        )
      ) {
        setParseError(
          'This multisig is already in your wallet. (Multiple imports of ' +
            'the same config produce the same address by design.)'
        );
        return;
      }
      setParsed(result.config);
      setLocalName(result.config.suggestedName ?? '');
      setLabels({});
      setVerified(false);
      setSaveError(null);
      setPhase('review');
      return;
    }

    // Strategy 2: legacy format from the official xx wallet.
    const legacy = parseLegacyMultisigSigners(raw);
    if (legacy) {
      setLegacySigners(legacy.signers);
      // Default threshold of 2 — the most common case. User adjusts.
      setLegacyThreshold(Math.min(2, legacy.signers.length));
      setLocalName(legacyName ?? '');
      setLabels({});
      setVerified(false);
      setSaveError(null);
      setPhase('legacy-review');
      return;
    }

    // Neither format. Surface the richer-format reason since it's
    // more informative — the legacy parser just returns null with no
    // message of its own.
    setParseError(result.reason);
  };

  const handleFile = (file: File) => {
    setParseError(null);

    // Opportunistic filename parsing for the official wallet's export
    // pattern: `<name>_<address>_<timestamp>.json`. Used as
    // informational cross-checks in the legacy review, not authority.
    const filenameAddress = extractAddressFromFilename(file.name);
    setLegacyFilenameAddress(filenameAddress);
    let filenameName: string | null = null;
    if (filenameAddress) {
      const idx = file.name.indexOf(filenameAddress);
      if (idx > 0) {
        const candidate = file.name.slice(0, idx).trim();
        // Strip trailing separator (underscore, dash, space).
        filenameName = candidate.replace(/[_\-\s]+$/, '').slice(0, 64);
      }
    }
    setLegacyFilenameName(filenameName);

    // Read via FileReader rather than the newer file.text() Promise
    // API. Mobile browsers sometimes mishandle the Promise across
    // the OS file-picker focus-return cycle — the promise resolves
    // into a remounted component and visibly bounces the user back
    // to the input phase. FileReader's event-based API is older but
    // more battle-tested through mobile page-lifecycle weirdness.
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      tryLoad(text, filenameName);
    };
    reader.onerror = () => {
      setParseError(
        `Couldn't read the file: ${reader.error?.message ?? 'unknown error'}`
      );
    };
    reader.readAsText(file);
  };

  const handleQrScan = (result: string) => {
    setScannerOpen(false);
    tryLoad(result);
  };

  const handlePasteSubmit = () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) {
      setParseError('Paste the config JSON content first.');
      return;
    }
    tryLoad(trimmed);
  };

  const handleSave = async () => {
    if (!verified) return;

    // Resolve which signer set + threshold + fallback nickname we're
    // saving from, depending on which review phase is active.
    let saveSigners: string[];
    let saveThreshold: number;
    let suggestedNameFallback: string | undefined;
    if (phase === 'review' && parsed) {
      saveSigners = parsed.signers;
      saveThreshold = parsed.threshold;
      suggestedNameFallback = parsed.suggestedName;
    } else if (phase === 'legacy-review' && legacySigners) {
      saveSigners = legacySigners;
      saveThreshold = legacyThreshold;
      suggestedNameFallback = legacyFilenameName ?? undefined;
    } else {
      return; // shouldn't happen; defensive
    }

    setSaveError(null);
    setSaving(true);
    try {
      // Transform signers into the {address, label?} shape expected by
      // the store.
      const signersWithLabels = saveSigners.map((address) => ({
        address,
        label: labels[address]?.trim() || undefined,
      }));
      const finalNickname =
        localName.trim() || suggestedNameFallback || 'Imported multisig';
      const multisig = await addMultisig({
        threshold: saveThreshold,
        signers: signersWithLabels,
        localName: finalNickname,
      });

      // Auto-add cosigner addresses to the address book so they show by
      // name across the wallet (pending action lists, approval flows,
      // etc.) instead of as truncated SS58 strings. Rules:
      //   - Skip the user's own accounts (already in the wallet,
      //     adding as a contact would be confusing duplication).
      //   - Skip addresses already in contacts (preserve the user's
      //     existing label — we don't overwrite their work).
      //   - Skip signers without a label — empty-name contacts are
      //     clutter; user can add manually later if they want.
      // The note field carries the multisig nickname so the user
      // remembers why the contact was added when they look at it later.
      for (const signer of signersWithLabels) {
        if (!signer.label) continue;
        if (accounts.some((a) => a.address === signer.address)) continue;
        if (contacts.some((c) => c.address === signer.address)) continue;
        try {
          addContact(
            signer.address,
            signer.label,
            `Cosigner of ${finalNickname}`
          );
        } catch {
          // A failed contact add shouldn't block the import — the
          // multisig itself is already saved by this point. Worst case
          // the user sees the address un-named in the wallet and adds
          // it to contacts later by hand.
        }
      }

      navigate(`/multisig/${multisig.address}`, { replace: true });
    } catch (err) {
      setSaveError((err as Error).message);
      setSaving(false);
    }
  };

  // ---------- Render ----------

  if (phase === 'input') {
    return (
      <>
        <TopBar title="Import multisig" showBack />

        {scannerOpen && (
          <QrScanner
            onScan={handleQrScan}
            onClose={() => setScannerOpen(false)}
          />
        )}

        <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
          <div className="card text-xs text-ink-300 leading-relaxed space-y-1.5">
            <p>
              Import a multisig config from another signer. Your wallet
              re-derives the multisig address from the JSON's parameters
              and refuses if anything's been tampered with — so it's
              safe to load configs received over Slack, email, AirDrop,
              or any other channel you trust the SENDER on.
            </p>
            <p className="text-ink-400">
              You will still confirm the signer addresses with at least
              one cosigner out-of-band before the wallet treats the
              config as canonical.
            </p>
          </div>

          {/* File picker — primary affordance */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary w-full"
          >
            <Upload size={16} strokeWidth={2} />
            Open config file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              // Reset the input so picking the same file twice still fires.
              e.target.value = '';
            }}
          />

          {/* QR scan */}
          <button
            onClick={() => setScannerOpen(true)}
            className="btn-secondary w-full"
          >
            <ScanLine size={16} strokeWidth={2} />
            Scan QR code
          </button>

          {/* Paste */}
          <button
            onClick={() => setPasteOpen((o) => !o)}
            className="btn-secondary w-full"
          >
            <Clipboard size={16} strokeWidth={2} />
            {pasteOpen ? 'Hide paste field' : 'Paste JSON'}
          </button>
          {pasteOpen && (
            <div className="card space-y-2">
              <textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder={
                  '{ "format": "xx-wallet-multisig-config", ... }'
                }
                rows={6}
                className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 font-mono text-xs text-ink-100 focus:outline-none focus:border-xx-500 resize-none"
              />
              <button
                onClick={handlePasteSubmit}
                className="btn-primary w-full text-sm"
              >
                <FileJson size={14} strokeWidth={2} />
                Validate and continue
              </button>
            </div>
          )}

          {parseError && (
            <div className="card border border-danger/30 bg-danger/5 space-y-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  size={14}
                  className="text-danger"
                  strokeWidth={2}
                />
                <p className="text-xs font-medium text-danger">
                  Couldn't import this config
                </p>
              </div>
              <p className="text-xs text-ink-300 leading-snug">
                {parseError}
              </p>
            </div>
          )}
        </div>
      </>
    );
  }

  // ---------- Legacy review phase ----------
  // Renders when the user loaded an official-wallet flat-array export.
  // Asks for the threshold + nickname (which our richer format would
  // carry inline). Live-derives the multisig address as the user
  // adjusts threshold so they see exactly what they're getting.
  //
  // Important: this branch runs UNCONDITIONALLY when phase is
  // 'legacy-review', not just when legacySigners is also populated.
  // The earlier version gated on `&& legacySigners` and fell through
  // to the !parsed setPhase('input') check on race, kicking the user
  // back to the input phase right after they picked a file. With this
  // structure, even if there's a transient render where legacySigners
  // hasn't populated yet, we render an empty placeholder that resolves
  // on the next render rather than resetting state.

  if (phase === 'legacy-review') {
    if (!legacySigners) {
      // Should be unreachable in normal flow — both setLegacySigners and
      // setPhase('legacy-review') happen in the same batched tryLoad
      // call. If it does happen (e.g., a future refactor introduces an
      // out-of-order update), render a brief placeholder rather than
      // calling setState during render and bouncing the user.
      return (
        <>
          <TopBar title="Loading…" showBack />
          <div className="px-5 py-6 max-w-md mx-auto" />
        </>
      );
    }
    return (
      <LegacyReview
        signers={legacySigners}
        threshold={legacyThreshold}
        onThresholdChange={setLegacyThreshold}
        localName={localName}
        onLocalNameChange={setLocalName}
        labels={labels}
        onLabelChange={(addr, val) =>
          setLabels((cur) => ({ ...cur, [addr]: val }))
        }
        verified={verified}
        onVerifiedChange={setVerified}
        accounts={accounts}
        existingMultisigs={existingMultisigs}
        filenameAddressHint={legacyFilenameAddress}
        filenameNameHint={legacyFilenameName}
        saving={saving}
        saveError={saveError}
        onBack={() => {
          setPhase('input');
          setLegacySigners(null);
        }}
        onSave={handleSave}
      />
    );
  }

  // ---------- Review phase (our richer format) ----------

  if (!parsed) {
    // Defensive — phase=review without a parsed config shouldn't
    // happen, but if it does, send back to input.
    setPhase('input');
    return null;
  }

  const userOwnedSigners = parsed.signers.filter((s) =>
    accounts.some((a) => a.address === s)
  );
  const userIsSigner = userOwnedSigners.length > 0;

  return (
    <>
      <TopBar title="Review import" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
        {/* Verification banner — proof the JSON's claimed address
            actually derives from its parameters. parseMultisigConfig
            already enforced this; surfacing it here gives the user a
            clear signal that the wallet has verified the config. */}
        <div className="card border border-xx-500/30 bg-xx-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck
              size={14}
              className="text-xx-500"
              strokeWidth={2.25}
            />
            <p className="text-xs uppercase tracking-wider text-xx-500 font-medium">
              Locally verified
            </p>
          </div>
          <p className="text-xs text-ink-200 leading-snug">
            The multisig address in this config matches what your wallet
            derived from the threshold + signers. The config has not
            been tampered with.
          </p>
        </div>

        {/* Multisig details */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Multisig
          </p>
          <div className="flex items-center gap-3">
            <AddressIcon address={parsed.multisigAddress} size={36} />
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-ink-100 break-all leading-snug">
                {parsed.multisigAddress}
              </p>
              <p className="text-xs text-ink-400 mt-0.5">
                {parsed.threshold}-of-{parsed.signers.length}
              </p>
            </div>
          </div>
          {!userIsSigner && (
            <div className="flex items-start gap-2 mt-1 p-2 rounded bg-amber-500/10 border border-amber-500/30">
              <Eye
                size={14}
                strokeWidth={2}
                className="text-amber-300 flex-shrink-0 mt-0.5"
              />
              <p className="text-xs text-amber-200 leading-snug">
                None of your wallet's accounts are signers of this
                multisig. You can import it as a watch-only view, but
                you won't be able to propose or approve.
              </p>
            </div>
          )}
        </div>

        {/* Local nickname */}
        <div className="card space-y-2">
          <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
            Local nickname
          </label>
          <input
            type="text"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder={
              parsed.suggestedName ?? 'e.g. Foundation Operations'
            }
            maxLength={64}
            className="input-base text-sm"
          />
          <p className="text-xs text-ink-400 leading-relaxed">
            Local label, only visible to you. Other signers can use
            different nicknames for the same multisig.
            {parsed.suggestedName && (
              <>
                {' '}
                (Sender suggested:{' '}
                <span className="text-ink-400">
                  "{parsed.suggestedName}"
                </span>
                .)
              </>
            )}
          </p>
        </div>

        {/* Signers — with optional per-signer labels. The "you" badge
            on rows that match the user's own accounts gives quick
            visual confirmation of which signer slot is yours. Labels
            you enter here ALSO get saved to your address book so the
            cosigner shows by name across the rest of the wallet
            (pending actions, approval screens, etc.) — see auto-add
            logic in handleSave. */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Signers ({parsed.signers.length})
            </p>
            <p className="text-xs uppercase tracking-wider text-ink-400">
              labeled = added to contacts
            </p>
          </div>
          <div className="space-y-2">
            {parsed.signers.map((addr) => {
              const ownAccount = accounts.find((a) => a.address === addr);
              const existingContact = contacts.find((c) => c.address === addr);
              return (
                <div key={addr} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AddressIcon address={addr} size={24} copyOnTap={false} />
                    <div className="flex-1 min-w-0">
                      {/* Show known-name + truncated fragment when this
                          address resolves to a wallet account / contact /
                          known multisig; otherwise just the truncated
                          fragment. Either way the address is visible. */}
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
                    value={
                      labels[addr] ??
                      ownAccount?.name ??
                      existingContact?.name ??
                      ''
                    }
                    onChange={(e) =>
                      setLabels((cur) => ({ ...cur, [addr]: e.target.value }))
                    }
                    placeholder="Optional label (e.g. Jim, Operations)"
                    maxLength={64}
                    className="input-base text-xs"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Out-of-band verification gate — the wallet has done all the
            cryptographic checks it can. The remaining attack surface
            is "the JSON is internally consistent but one of the
            signers isn't who I think it is." Mitigation is human
            verification: confirm the addresses with another cosigner
            you trust by voice/video before treating the config as
            canonical. */}
        <div className="card border border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <Key size={14} strokeWidth={2.25} className="text-amber-400" />
            <p className="text-xs font-medium text-amber-200">
              Verify with a cosigner
            </p>
          </div>
          <p className="text-xs text-ink-200 leading-relaxed">
            Anyone can put your address into a multisig signer set —
            that alone is not proof the multisig is legitimate. Confirm
            with at least one cosigner out-of-band (voice, video, in
            person) that the signer addresses above are who you think
            they are.
          </p>
          <label className="flex items-start gap-2 mt-1 text-xs text-ink-200 leading-snug cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="mt-0.5 w-3.5 h-3.5 accent-amber-500 flex-shrink-0"
            />
            <span>
              I have verified the signer addresses out-of-band and want
              to import this multisig.
            </span>
          </label>
        </div>

        {parsed.createdBy && (
          <p className="text-xs text-ink-400 px-1 leading-relaxed">
            Sender claims this config was created by{' '}
            <span className="font-mono text-ink-400">
              {shortenAddress(parsed.createdBy, { start: 8, end: 6 })}
            </span>
            . The wallet has not authenticated this — it's
            informational only.
          </p>
        )}

        {saveError && (
          <div className="card border border-danger/30 bg-danger/5">
            <div className="flex items-start gap-2">
              <X
                size={14}
                strokeWidth={2.25}
                className="text-danger mt-0.5 flex-shrink-0"
              />
              <p className="text-xs text-danger leading-snug">{saveError}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => {
              setPhase('input');
              setParsed(null);
            }}
            className="btn-secondary"
          >
            Back
          </button>
          <button
            onClick={handleSave}
            disabled={!verified || saving}
            className={clsx('btn-primary', (!verified || saving) && 'opacity-50 cursor-not-allowed')}
          >
            <Check size={16} strokeWidth={2} />
            {saving ? 'Saving…' : 'Import multisig'}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Legacy-format review sub-component. Used when the user imported a
 * flat-array signer list (the official xx wallet's export shape). Asks
 * for the missing pieces (threshold, nickname) and live-derives the
 * resulting multisig address as the user adjusts inputs so they can
 * see exactly what they're getting before save.
 *
 * The verification model is necessarily weaker here than in the
 * canonical-format review: we have no claimed multisig address to
 * cross-check against. The integrity guarantee is replaced with "the
 * user picked the threshold; the wallet derives the address; the user
 * confirms before save". The amber filename-hint banner adds a soft
 * cross-check when the official-wallet filename pattern is present.
 */
function LegacyReview({
  signers,
  threshold,
  onThresholdChange,
  localName,
  onLocalNameChange,
  labels,
  onLabelChange,
  verified,
  onVerifiedChange,
  accounts,
  existingMultisigs,
  filenameAddressHint,
  filenameNameHint,
  saving,
  saveError,
  onBack,
  onSave,
}: {
  signers: string[];
  threshold: number;
  onThresholdChange: (n: number) => void;
  localName: string;
  onLocalNameChange: (v: string) => void;
  labels: Record<string, string>;
  onLabelChange: (address: string, val: string) => void;
  verified: boolean;
  onVerifiedChange: (v: boolean) => void;
  accounts: Array<{ address: string; name: string }>;
  existingMultisigs: Array<{ address: string }>;
  filenameAddressHint: string | null;
  filenameNameHint: string | null;
  saving: boolean;
  saveError: string | null;
  onBack: () => void;
  onSave: () => void;
}) {
  // Look up address-book contacts so the signer rows can show
  // known-contact names alongside the truncated address fragment, and
  // so the per-signer label inputs can default to the existing contact
  // name when one exists (just like the canonical-format flow).
  const { contacts } = useAddressBook();

  // Derive the multisig address live as the user adjusts threshold.
  // The wallet computes this locally from (threshold, signers); the
  // user sees what they're committing to before they tap Save.
  const derivedAddress = useMemo(() => {
    if (threshold < 1 || threshold > signers.length) return null;
    try {
      return deriveMultisigAddress(threshold, signers);
    } catch {
      return null;
    }
  }, [threshold, signers]);

  const userOwnedSigners = signers.filter((s) =>
    accounts.some((a) => a.address === s)
  );
  const userIsSigner = userOwnedSigners.length > 0;

  const filenameMatches =
    filenameAddressHint != null &&
    derivedAddress != null &&
    filenameAddressHint === derivedAddress;

  const alreadyImported =
    derivedAddress != null &&
    existingMultisigs.some((m) => m.address === derivedAddress);

  const canSave =
    derivedAddress !== null &&
    !alreadyImported &&
    threshold >= 1 &&
    threshold <= signers.length &&
    verified &&
    !saving;

  return (
    <>
      <TopBar title="Review legacy import" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
        {/* Banner explaining what kind of file we loaded + why the
            user has to do more work than the canonical-format flow */}
        <div className="card border border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <FileJson
              size={14}
              className="text-amber-400"
              strokeWidth={2.25}
            />
            <p className="text-xs uppercase tracking-wider text-amber-200 font-medium">
              Legacy format — additional input needed
            </p>
          </div>
          <p className="text-xs text-ink-200 leading-relaxed">
            This file is in the official xx wallet's export format,
            which carries only the signer addresses. To finish the
            import, set the multisig's threshold and confirm the
            address that derives from your inputs.
          </p>
        </div>

        {/* Live-derived multisig address — the central thing the user
            must see before save. Updates as they change the threshold. */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Multisig address (derived from your inputs)
          </p>
          {derivedAddress ? (
            <p className="font-mono text-xs text-ink-100 break-all leading-snug">
              {derivedAddress}
            </p>
          ) : (
            <p className="text-xs text-ink-400">
              Pick a valid threshold to see the derived address.
            </p>
          )}

          {filenameAddressHint && derivedAddress && (
            <div
              className={clsx(
                'flex items-start gap-2 p-2 rounded',
                filenameMatches
                  ? 'bg-xx-500/10 border border-xx-500/30'
                  : 'bg-amber-500/10 border border-amber-500/30'
              )}
            >
              {filenameMatches ? (
                <Check
                  size={14}
                  strokeWidth={2}
                  className="text-xx-500 mt-0.5 flex-shrink-0"
                />
              ) : (
                <AlertTriangle
                  size={14}
                  strokeWidth={2}
                  className="text-amber-400 mt-0.5 flex-shrink-0"
                />
              )}
              <div className="text-xs leading-snug">
                {filenameMatches ? (
                  <p className="text-ink-200">
                    Filename matches the derived address — extra
                    confidence that this is the multisig you expect.
                  </p>
                ) : (
                  <>
                    <p className="text-amber-200 font-medium">
                      Filename and derived address don't match
                    </p>
                    <p className="text-ink-300 mt-0.5">
                      The filename suggests{' '}
                      <span className="font-mono">
                        {shortenAddress(filenameAddressHint, {
                          start: 8,
                          end: 6,
                        })}
                      </span>
                      , but your threshold derives a different address.
                      Try threshold 2 if the file came from a 2-of-N
                      multisig (most common).
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {alreadyImported && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle
                size={14}
                strokeWidth={2}
                className="text-amber-400 mt-0.5 flex-shrink-0"
              />
              <p className="text-xs text-amber-200 leading-snug">
                This multisig is already in your wallet.
              </p>
            </div>
          )}

          {!userIsSigner && derivedAddress && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
              <Eye
                size={14}
                strokeWidth={2}
                className="text-amber-300 mt-0.5 flex-shrink-0"
              />
              <p className="text-xs text-amber-200 leading-snug">
                None of your wallet's accounts are in this signer set —
                you can import as a watch-only view but won't be able
                to propose or approve.
              </p>
            </div>
          )}
        </div>

        {/* Threshold input */}
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Threshold (signatures required)
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onThresholdChange(Math.max(1, threshold - 1))}
              disabled={threshold <= 1}
              className="w-9 h-9 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center active:bg-ink-700 disabled:opacity-40"
            >
              −
            </button>
            <div className="flex items-baseline gap-1.5 flex-1 justify-center">
              <span className="text-2xl font-display font-medium text-ink-100 numeric">
                {threshold}
              </span>
              <span className="text-sm text-ink-400">of {signers.length}</span>
            </div>
            <button
              type="button"
              onClick={() =>
                onThresholdChange(Math.min(signers.length, threshold + 1))
              }
              disabled={threshold >= signers.length}
              className="w-9 h-9 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center active:bg-ink-700 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <p className="text-xs text-ink-400 text-center leading-relaxed">
            Most foundation multisigs use 2-of-N. If you're not sure,
            check with another cosigner.
          </p>
        </div>

        {/* Local nickname */}
        <div className="card space-y-2">
          <label className="block text-xs uppercase tracking-wider text-ink-400 font-medium">
            Local nickname
          </label>
          <input
            type="text"
            value={localName}
            onChange={(e) => onLocalNameChange(e.target.value)}
            placeholder={filenameNameHint ?? 'e.g. Foundation Operations'}
            maxLength={64}
            className="input-base text-sm"
          />
          {filenameNameHint && (
            <p className="text-xs text-ink-400 leading-relaxed">
              Filename suggests:{' '}
              <span className="text-ink-400">"{filenameNameHint}"</span>
            </p>
          )}
        </div>

        {/* Signers + per-signer labels */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Signers ({signers.length})
            </p>
            <p className="text-xs uppercase tracking-wider text-ink-400">
              labeled = added to contacts
            </p>
          </div>
          <div className="space-y-2">
            {signers.map((addr) => {
              const ownAccount = accounts.find((a) => a.address === addr);
              const existingContact = contacts.find((c) => c.address === addr);
              return (
                <div key={addr} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AddressIcon address={addr} size={24} copyOnTap={false} />
                    <div className="flex-1 min-w-0">
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
                    value={
                      labels[addr] ??
                      ownAccount?.name ??
                      existingContact?.name ??
                      ''
                    }
                    onChange={(e) => onLabelChange(addr, e.target.value)}
                    placeholder="Optional label (e.g. Jim, Operations)"
                    maxLength={64}
                    className="input-base text-xs"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Verify out-of-band — same gate as canonical-format flow */}
        <div className="card border border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <Key size={14} strokeWidth={2.25} className="text-amber-400" />
            <p className="text-xs font-medium text-amber-200">
              Verify with a cosigner
            </p>
          </div>
          <p className="text-xs text-ink-200 leading-relaxed">
            Confirm out-of-band (voice, video, in person) with at
            least one cosigner that the threshold and signer
            addresses above are correct. Anyone can put your address
            into a multisig signer set — that alone is not proof the
            multisig is legitimate.
          </p>
          <label className="flex items-start gap-2 mt-1 text-xs text-ink-200 leading-snug cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => onVerifiedChange(e.target.checked)}
              className="mt-0.5 w-3.5 h-3.5 accent-amber-500 flex-shrink-0"
            />
            <span>
              I have verified the threshold + signer addresses
              out-of-band and want to import this multisig.
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
              <p className="text-xs text-danger leading-snug">{saveError}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button onClick={onBack} className="btn-secondary">
            Back
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className={clsx(
              'btn-primary',
              !canSave && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Check size={16} strokeWidth={2} />
            {saving ? 'Saving…' : 'Import multisig'}
          </button>
        </div>
      </div>
    </>
  );
}

