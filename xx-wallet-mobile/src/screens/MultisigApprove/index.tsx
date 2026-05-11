/**
 * MultisigApprove — the trust-minimization payoff screen.
 *
 * For a single pending multisig proposal, this screen:
 *   - Confirms the proposal exists on chain (else bounces).
 *   - Renders a description derived from the call BYTES, not from any
 *     out-of-band-supplied text. The description is the wallet's own
 *     read of the bytes, gated by hash + address-derivation verification.
 *   - If the bytes haven't arrived yet (no cache, no paste), shows a
 *     conscious-acknowledgement path so the user can still approve at
 *     their own risk — but with the trust-decision made visible (per
 *     §6.4 update agreed with Aaron).
 *   - Wires the Approve / Approve-and-execute / Cancel actions. Signing
 *     itself is wired via useTx in slice 2.5; this screen owns the UI
 *     and the verification gates.
 *
 * The line that doesn't move: the wallet NEVER displays a depositor-
 * supplied description as if it came from our decoder. Either we render
 * what we decoded, or we render a warning that we have no decoded view.
 *
 * See  §6.4.
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Users,
  ShieldCheck,
  AlertTriangle,
  Clipboard,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { hexToU8a } from '@polkadot/util';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { AddressChip, Sheet } from '@/components/ui';
import { useApi, usePendingMultisigs, useTx } from '@/hooks';
import {
  useAccountsStore,
  useMultisigsStore,
  usePendingBytesStore,
} from '@/store';
import {
  decodeCall,
  multisigAddressMatches,
  normalizeCallBytes,
  shortenAddress,
  verifyCallHash,
  type DecodedCall,
} from '@/utils';

/**
 * Generous static weight for the inner call. The foundation's actual
 * usage measured in the spike was {refTime: 146_841_000, proofSize: 3593}
 * (transferKeepAlive). We pass ~3x that to absorb any future runtime
 * changes without tx failures; the chain charges only for actual usage,
 * so over-quoting wastes nothing beyond the deposit reserve calculation
 * which is negligible for the foundation.
 *
 * Slice 7 will compute this dynamically via paymentInfo on the inner call
 * (which requires reorganizing useTx to accept async builders).
 */
const STATIC_INNER_CALL_WEIGHT = {
  refTime: 500_000_000,
  proofSize: 10_000,
};

type UserRole =
  | 'depositor' // user proposed it
  | 'pending-approver' // user is a signer who hasn't approved
  | 'already-approved' // user is a signer who's already approved
  | 'not-a-signer'; // user isn't on the multisig (defensive — shouldn't see this)

export function MultisigApprove() {
  const { address, callHash } = useParams<{
    address: string;
    callHash: string;
  }>();
  const multisig = useMultisigsStore((s) =>
    address ? s.getMultisig(address) : undefined
  );

  if (!address || !callHash || !multisig) {
    return <Navigate to="/" replace />;
  }

  return (
    <ApproveView
      address={address}
      callHash={callHash.toLowerCase()}
    />
  );
}

function ApproveView({
  address,
  callHash,
}: {
  address: string;
  callHash: string;
}) {
  const navigate = useNavigate();
  const multisig = useMultisigsStore((s) => s.getMultisig(address))!;
  const { activeAddress } = useAccountsStore();
  const { pending, isLoading: pendingLoading } = usePendingMultisigs(address);
  const cachedEntry = usePendingBytesStore((s) => s.getBytes(address, callHash));
  const putBytes = usePendingBytesStore((s) => s.putBytes);
  const removeBytes = usePendingBytesStore((s) => s.removeBytes);
  const api = useApi();
  const {
    submit,
    status: txStatus,
    error: txError,
    txHash,
    reset: resetTx,
  } = useTx();

  // Find the specific pending proposal we're approving
  const proposal = pending.find((p) => p.callHash === callHash);

  // Paste affordance state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Conscious-acknowledgement checkbox for the no-bytes path
  const [consciousAck, setConsciousAck] = useState(false);

  // Collapsibles
  const [bytesOpen, setBytesOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);

  // Confirmation sheet (password + submit)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const isSubmitting =
    txStatus === 'signing' ||
    txStatus === 'broadcasting' ||
    txStatus === 'in-block';
  const isDone = txStatus === 'finalized';
  const submitLabel = (() => {
    switch (txStatus) {
      case 'signing':
        return 'Signing…';
      case 'broadcasting':
        return 'Sending to network…';
      case 'in-block':
        return 'Waiting for finality…';
      case 'finalized':
        return 'Done';
      default:
        return 'Confirm and approve';
    }
  })();

  // Derive once we know what bytes we have
  const bytesAvailable = !!cachedEntry?.callBytes;
  const callBytes = cachedEntry?.callBytes ?? null;

  // Hash verification (cheap, repeated on every render — defensive)
  const hashVerified = useMemo(() => {
    if (!callBytes) return false;
    return verifyCallHash(callBytes, callHash);
  }, [callBytes, callHash]);

  // Multisig address-derivation verification
  // Re-derive the multisig address from (threshold, signers) and confirm
  // it matches the address being acted on. Mismatch = loud refusal.
  const addressVerified = useMemo(() => {
    return multisigAddressMatches(
      address,
      multisig.threshold,
      multisig.signers.map((s) => s.address)
    );
  }, [address, multisig.threshold, multisig.signers]);

  // Decode the bytes (only when we have them AND hash verifies).
  const [decoded, setDecoded] = useState<DecodedCall | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  useEffect(() => {
    setDecoded(null);
    setDecodeError(null);
    if (!callBytes || !hashVerified || !api) return;
    try {
      setDecoded(decodeCall(callBytes, api));
    } catch (e) {
      setDecodeError((e as Error).message);
    }
  }, [callBytes, hashVerified, api]);

  // What's the user's role on this proposal?
  const userRole: UserRole = useMemo(() => {
    if (!activeAddress) return 'not-a-signer';
    if (!proposal) return 'not-a-signer';
    const isSigner = multisig.signers.some(
      (s) => s.address === activeAddress
    );
    if (!isSigner) return 'not-a-signer';
    if (proposal.depositor === activeAddress) return 'depositor';
    if (proposal.approvals.includes(activeAddress)) return 'already-approved';
    return 'pending-approver';
  }, [activeAddress, proposal, multisig.signers]);

  // Will the next approval execute? (At threshold-1 approvals, the next
  // signature finalizes the call.)
  const nextApprovalExecutes =
    proposal != null && proposal.approvals.length === multisig.threshold - 1;

  // Did we still find a pending proposal? If `pending` finished loading
  // but no entry matches our callHash, the proposal must have just
  // executed or been cancelled — bounce back to the multisig detail.
  if (!pendingLoading && !proposal) {
    return (
      <>
        <TopBar title="Proposal not found" showBack />
        <div className="px-5 py-6 max-w-md mx-auto space-y-4">
          <div className="card text-center space-y-2">
            <AlertTriangle
              size={32}
              className="text-amber-400 mx-auto"
              strokeWidth={1.5}
            />
            <p className="text-sm text-ink-200">
              This proposal is no longer pending on chain.
            </p>
            <p className="text-xs text-ink-500">
              It may have just executed, been cancelled, or been completed
              from another device.
            </p>
          </div>
          <button
            onClick={() => navigate(`/multisig/${address}`, { replace: true })}
            className="btn-primary w-full"
          >
            Back to {multisig.localName}
          </button>
        </div>
      </>
    );
  }

  // Address-derivation safety gate. If for any reason the stored multisig
  // record's (threshold, signers) doesn't actually derive to the address
  // we're acting on, refuse rather than risk approving the wrong thing.
  // Should be impossible given slice 1.5's import path validates this on
  // create, but defensive — this is the kind of check that's free to do
  // and catastrophic if missed.
  if (!addressVerified) {
    return (
      <>
        <TopBar title="Verification failed" showBack />
        <div className="px-5 py-6 max-w-md mx-auto space-y-4">
          <div className="card border border-danger/30 bg-danger/5 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle
                size={18}
                className="text-danger"
                strokeWidth={2}
              />
              <p className="text-sm font-medium text-danger">
                Multisig address mismatch
              </p>
            </div>
            <p className="text-xs text-ink-300 leading-relaxed">
              The signers + threshold in your local record don't derive to
              this multisig's address. Approving could send funds somewhere
              you don't intend. Remove and re-import this multisig to fix.
            </p>
          </div>
        </div>
      </>
    );
  }

  const handlePaste = () => {
    setPasteError(null);
    const trimmed = pasted.trim();
    if (!trimmed) {
      setPasteError('Paste the call data (0x-prefixed hex).');
      return;
    }
    const normalized = normalizeCallBytes(trimmed);
    if (!verifyCallHash(normalized, callHash)) {
      setPasteError(
        'This call data does not hash to the on-chain call hash for this proposal. ' +
          'Either the call data is wrong, the proposer sent the wrong hash, ' +
          'or someone tampered with one of the two.'
      );
      return;
    }
    putBytes({
      multisigAddress: address,
      callHash,
      callBytes: normalized,
      source: 'received',
      receivedAt: Date.now(),
    });
    setPasted('');
    setPasteOpen(false);
  };

  const handleApprove = () => {
    // Open the confirm sheet — password capture + submit happens there.
    resetTx();
    setPasswordError(null);
    setConfirmOpen(true);
  };

  const handleConfirmApprove = async () => {
    if (!activeAddress || !proposal || !callBytes) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => {
          // Decode the call bytes locally so the chain receives a typed
          // Call rather than raw bytes — this also implicitly re-validates
          // the bytes against the runtime metadata at submission time.
          const innerCall = api.registry.createType(
            'Call',
            hexToU8a(callBytes)
          );

          // other_signatories: every signer EXCEPT the user, sorted SS58.
          // Substrate sorts them internally too, but we sort here for
          // consistency in case a future runtime change drops the
          // internal sort.
          const otherSignatories = multisig.signers
            .map((s) => s.address)
            .filter((a) => a !== activeAddress)
            .sort();

          // The Timepoint of the original proposal — required for any
          // approve / cancel after the first signature.
          const timepoint = {
            height: proposal.whenBlock,
            index: proposal.whenIndex,
          };

          return api.tx.multisig.asMulti(
            multisig.threshold,
            otherSignatories,
            timepoint,
            innerCall,
            STATIC_INNER_CALL_WEIGHT
          );
        },
        { address: activeAddress, password }
      );
      // On finalized, the tx hook flips status to 'finalized' and the
      // success sheet (driven by `isDone`) appears. The user dismisses
      // it which navigates back to the multisig detail.
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('unable to decode') ||
        msg.toLowerCase().includes('incorrect')
      ) {
        setPasswordError('Incorrect password. Please try again.');
      }
      // Other errors surface in the sheet via the txError block.
    }
  };

  const handleClearBytes = () => {
    if (callBytes) removeBytes(address, callHash);
  };

  const closeConfirm = () => {
    if (isSubmitting) return; // never let the user dismiss mid-broadcast
    setConfirmOpen(false);
    setPassword('');
    setPasswordError(null);
    resetTx();
  };

  const closeSuccess = () => {
    // Once executed, the proposal is gone from chain — remove the cached
    // bytes (no longer needed) and head back to the multisig detail.
    if (callBytes) removeBytes(address, callHash);
    resetTx();
    setConfirmOpen(false);
    navigate(`/multisig/${address}`, { replace: true });
  };

  return (
    <>
      <TopBar title="Approve proposal" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
        {/* Header: which multisig + role context */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-xx-500" strokeWidth={2.25} />
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              {multisig.localName}
            </p>
            <span className="text-[10px] text-ink-500">
              · {multisig.threshold}-of-{multisig.signers.length}
            </span>
          </div>
          <RoleBanner role={userRole} />
        </div>

        {/* Description — the central UX moment */}
        {bytesAvailable && hashVerified && decoded && (
          <DecodedDescriptionCard decoded={decoded} />
        )}
        {bytesAvailable && hashVerified && !decoded && !decodeError && (
          <div className="card text-xs text-ink-400">Decoding…</div>
        )}
        {bytesAvailable && hashVerified && decodeError && (
          <DecodeErrorCard message={decodeError} />
        )}
        {bytesAvailable && !hashVerified && (
          <HashMismatchCard
            onClear={handleClearBytes}
          />
        )}
        {!bytesAvailable && (
          <NoBytesCard
            consciousAck={consciousAck}
            onAckChange={setConsciousAck}
            onOpenPaste={() => setPasteOpen((o) => !o)}
            pasteOpen={pasteOpen}
          />
        )}

        {/* Paste affordance */}
        {pasteOpen && (
          <div className="card space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">
              Paste call data
            </p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="0x..."
              rows={4}
              className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 font-mono text-xs text-ink-100 focus:outline-none focus:border-xx-500 resize-none"
            />
            {pasteError && (
              <p className="text-xs text-danger leading-snug">{pasteError}</p>
            )}
            <button
              onClick={handlePaste}
              className="btn-primary w-full text-sm"
            >
              <Clipboard size={14} strokeWidth={2} />
              Verify and load
            </button>
            <p className="text-[10px] text-ink-500 leading-relaxed">
              The wallet will hash this call data locally and confirm it
              matches the on-chain call hash before showing the decoded
              action. Call data that doesn't match is rejected, not displayed.
            </p>
          </div>
        )}

        {/* Proposal metadata: who proposed, when */}
        {proposal && (
          <div className="card space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">
              Proposal details
            </p>
            <DetailRow
              label="Proposed by"
              value={shortenAddress(proposal.depositor)}
              mono
            />
            <DetailRow
              label="At block"
              value={`#${proposal.whenBlock.toLocaleString()}`}
              mono
            />
            <DetailRow
              label="Approvals so far"
              value={`${proposal.approvals.length} of ${multisig.threshold} required`}
            />
            <div className="space-y-1 pt-1">
              {multisig.signers.map((s) => {
                const hasApproved = proposal.approvals.includes(s.address);
                return (
                  <div
                    key={s.address}
                    className="flex items-center gap-2 text-xs"
                  >
                    <div
                      className={clsx(
                        'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                        hasApproved
                          ? 'bg-xx-500/20 text-xx-500'
                          : 'border border-ink-700'
                      )}
                    >
                      {hasApproved && (
                        <Check size={10} strokeWidth={2.5} />
                      )}
                    </div>
                    <span
                      className={clsx(
                        'font-mono text-ink-300 truncate',
                        hasApproved && 'text-ink-200'
                      )}
                    >
                      {s.label || shortenAddress(s.address)}
                    </span>
                    {s.address === proposal.depositor && (
                      <span className="text-[9px] uppercase tracking-wider text-ink-500 ml-auto">
                        depositor
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Raw bytes — collapsible */}
        {bytesAvailable && (
          <Collapsible
            open={bytesOpen}
            onToggle={() => setBytesOpen((o) => !o)}
            label="Raw call data"
          >
            <p className="font-mono text-[11px] text-ink-200 break-all leading-relaxed select-all">
              {callBytes}
            </p>
          </Collapsible>
        )}

        {/* Verification details — collapsible */}
        {bytesAvailable && (
          <Collapsible
            open={verificationOpen}
            onToggle={() => setVerificationOpen((o) => !o)}
            label="Verification"
          >
            <div className="space-y-1.5 text-xs">
              <VerifyRow
                label="Call data hash matches on-chain hash"
                ok={hashVerified}
              />
              <VerifyRow
                label="Multisig address derives from your stored signers"
                ok={addressVerified}
              />
              <p className="font-mono text-[10px] text-ink-500 break-all pt-1">
                On-chain call hash: {callHash}
              </p>
            </div>
          </Collapsible>
        )}

        {/* Action buttons */}
        <div className="space-y-2 pt-2">
          {userRole === 'pending-approver' && (
            <button
              onClick={handleApprove}
              disabled={
                (bytesAvailable && !hashVerified) ||
                (!bytesAvailable && !consciousAck)
              }
              className={clsx(
                'btn-primary w-full',
                ((bytesAvailable && !hashVerified) ||
                  (!bytesAvailable && !consciousAck)) &&
                  'opacity-50 cursor-not-allowed'
              )}
            >
              <ShieldCheck size={16} strokeWidth={2} />
              {nextApprovalExecutes
                ? 'Approve and execute'
                : 'Approve'}
            </button>
          )}
          {userRole === 'already-approved' && (
            <div className="card text-center text-xs text-ink-400">
              You've already approved this proposal. Awaiting{' '}
              {multisig.threshold - (proposal?.approvals.length ?? 0)} more
              signature
              {multisig.threshold -
                (proposal?.approvals.length ?? 0) !==
              1
                ? 's'
                : ''}
              .
            </div>
          )}
          {userRole === 'depositor' && (
            <div className="card text-center text-xs text-ink-400">
              You proposed this. Cancellation comes in slice 4 — for now,
              the proposal sits until enough cosigners approve or you
              navigate elsewhere.
            </div>
          )}
          {userRole === 'not-a-signer' && (
            <div className="card text-center text-xs text-ink-400">
              You're not a signer on this multisig. There's nothing to
              approve.
            </div>
          )}
        </div>
      </div>

      {/* Confirm sheet — captures password and submits asMulti */}
      <Sheet
        open={confirmOpen && !isDone}
        onClose={closeConfirm}
        title={nextApprovalExecutes ? 'Confirm and execute' : 'Confirm approval'}
      >
        <div className="space-y-4">
          <div className="space-y-3 p-4 rounded-2xl bg-ink-800 border border-ink-700/50">
            <Row label="Multisig">
              <span className="font-medium text-sm">{multisig.localName}</span>
            </Row>
            <Row label="Action">
              <span className="text-sm text-ink-100 leading-snug whitespace-pre-line">
                {decoded?.friendly ?? decoded?.literal ?? '(no decoded view)'}
              </span>
            </Row>
            <Row label="Effect">
              <span className="text-xs text-ink-300 leading-snug">
                {nextApprovalExecutes
                  ? 'Your approval will be the threshold-meeting signature; the inner action will execute on chain immediately.'
                  : `Your approval will be recorded. ${
                      multisig.threshold -
                      (proposal?.approvals.length ?? 0) -
                      1
                    } more signature(s) needed before execution.`}
              </span>
            </Row>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              className="input-base"
              placeholder="Enter your wallet password to sign"
              autoComplete="current-password"
              disabled={isSubmitting}
            />
            {passwordError && (
              <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
                <AlertTriangle size={12} />
                {passwordError}
              </p>
            )}
          </div>

          {txError && !passwordError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
              <AlertTriangle
                size={16}
                className="text-danger flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="font-medium mb-0.5">Approval failed</p>
                <p className="text-xs text-ink-300 break-all">
                  {txError.message}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirmApprove}
            disabled={isSubmitting || !password}
            className="btn-primary w-full"
          >
            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </Sheet>

      {/* Success sheet */}
      <Sheet open={isDone} onClose={closeSuccess}>
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-xx-500/10 border border-xx-500/40 flex items-center justify-center">
            <Check size={32} className="text-xx-500" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-xl">
              {nextApprovalExecutes ? 'Executed' : 'Approval recorded'}
            </h2>
            <p className="text-sm text-ink-400 mt-1">
              {nextApprovalExecutes
                ? 'Threshold met — the inner action ran on chain.'
                : 'Your signature is on chain. Awaiting remaining cosigners.'}
            </p>
          </div>
          {txHash && (
            <div className="w-full">
              <p className="text-xs text-ink-400 mb-1 uppercase tracking-wide">
                Transaction hash
              </p>
              <AddressChip address={txHash} shortened className="w-full" />
            </div>
          )}
          <button onClick={closeSuccess} className="btn-primary w-full mt-2">
            Done
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-ink-400 uppercase tracking-wide flex-shrink-0 pt-0.5">
        {label}
      </span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

// ---------- Sub-components ----------

function RoleBanner({ role }: { role: UserRole }) {
  const text = (() => {
    switch (role) {
      case 'pending-approver':
        return 'You are being asked to approve this proposal.';
      case 'depositor':
        return 'You proposed this. Awaiting other signers.';
      case 'already-approved':
        return "You've approved this. Awaiting other signers.";
      case 'not-a-signer':
        return "You're not a signer on this multisig.";
    }
  })();
  return (
    <h1 className="text-lg font-display font-medium text-ink-100 leading-snug">
      {text}
    </h1>
  );
}

function DecodedDescriptionCard({ decoded }: { decoded: DecodedCall }) {
  const description = decoded.friendly ?? decoded.literal;
  const isFriendly = decoded.friendly !== null;
  return (
    <div className="card space-y-3 border border-xx-500/30 bg-xx-500/5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-xx-500" strokeWidth={2.25} />
        <p className="text-[10px] uppercase tracking-wider text-xx-500 font-medium">
          Decoded by your wallet from verified call data
        </p>
      </div>
      <p className="text-base text-ink-100 leading-snug whitespace-pre-line">
        {description}
      </p>
      {!isFriendly && (
        <p className="text-[11px] text-amber-300 leading-snug">
          This call type is not specifically recognized by the wallet —
          the description above is the literal pallet method and arguments.
          Read carefully before approving.
        </p>
      )}
    </div>
  );
}

function DecodeErrorCard({ message }: { message: string }) {
  return (
    <div className="card border border-danger/30 bg-danger/5 space-y-2">
      <div className="flex items-center gap-2">
        <X size={14} className="text-danger" strokeWidth={2} />
        <p className="text-xs font-medium text-danger">
          Could not decode call data
        </p>
      </div>
      <p className="text-[11px] text-ink-300 leading-snug">{message}</p>
      <p className="text-[10px] text-ink-500 leading-snug">
        The call data hashes to the right value but doesn't decode against
        the current chain runtime. This shouldn't normally happen unless
        there's a runtime version mismatch.
      </p>
    </div>
  );
}

function HashMismatchCard({ onClear }: { onClear: () => void }) {
  return (
    <div className="card border border-danger/30 bg-danger/5 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-danger" strokeWidth={2} />
        <p className="text-xs font-medium text-danger">
          Hash mismatch — refusing to render
        </p>
      </div>
      <p className="text-[11px] text-ink-300 leading-snug">
        The cached call data for this proposal does not hash to the
        on-chain call hash. Either the call data was tampered with, the
        cache is stale, or someone sent the wrong call data. The wallet
        refuses to decode or render this — clear it and re-paste.
      </p>
      <button
        onClick={onClear}
        className="text-xs text-danger active:text-danger/80 underline"
      >
        Clear cached call data
      </button>
    </div>
  );
}

function NoBytesCard({
  consciousAck,
  onAckChange,
  onOpenPaste,
  pasteOpen,
}: {
  consciousAck: boolean;
  onAckChange: (v: boolean) => void;
  onOpenPaste: () => void;
  pasteOpen: boolean;
}) {
  return (
    <div className="card border border-amber-500/30 bg-amber-500/5 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle
          size={14}
          className="text-amber-400"
          strokeWidth={2}
        />
        <p className="text-xs font-medium text-amber-200">
          No call data available
        </p>
      </div>
      <p className="text-[11px] text-ink-200 leading-relaxed">
        Your wallet cannot show what this proposal does. Approving
        without seeing the decoded action means trusting the proposer's
        description from another channel. Proceed only if you have
        independently confirmed what this call does.
      </p>
      <button
        onClick={onOpenPaste}
        className="btn-secondary w-full text-sm"
      >
        <Clipboard size={14} strokeWidth={2} />
        {pasteOpen ? 'Hide paste field' : 'Paste call data'}
      </button>
      <label className="flex items-start gap-2 text-[11px] text-ink-300 leading-snug cursor-pointer select-none">
        <input
          type="checkbox"
          checked={consciousAck}
          onChange={(e) => onAckChange(e.target.checked)}
          className="mt-0.5 w-3.5 h-3.5 accent-xx-500 flex-shrink-0"
        />
        <span>
          I understand I'm approving without my wallet's verification of
          what this call does, and I want to proceed.
        </span>
      </label>
    </div>
  );
}

function Collapsible({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-500 font-medium"
      >
        <span>{label}</span>
        {open ? (
          <ChevronUp size={14} strokeWidth={2} />
        ) : (
          <ChevronDown size={14} strokeWidth={2} />
        )}
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-400">{label}</span>
      <span
        className={clsx('text-sm text-ink-200', mono && 'font-mono')}
      >
        {value}
      </span>
    </div>
  );
}

function VerifyRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <Check size={12} className="text-xx-500" strokeWidth={2.5} />
      ) : (
        <X size={12} className="text-danger" strokeWidth={2.5} />
      )}
      <span className={clsx('text-xs', ok ? 'text-ink-200' : 'text-danger')}>
        {label}
      </span>
    </div>
  );
}
