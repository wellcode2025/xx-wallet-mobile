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
 *     itself is wired via useTx; this screen owns the UI
 *     and the verification gates.
 *
 * The line that doesn't move: the wallet NEVER displays a depositor-
 * supplied description as if it came from our decoder. Either we render
 * what we decoded, or we render a warning that we have no decoded view.
 *
 * The approval surface decodes from the call bytes and hash-gates against
 * the chain — never trusting depositor-supplied text.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Users,
  ShieldCheck,
  AlertTriangle,
  Clipboard,
  ChevronDown,
  ChevronUp,
  Check,
  Key,
  ScanLine,
  Upload,
  X,
  Loader2,
  Send,
} from 'lucide-react';
import { hexToU8a } from '@polkadot/util';
import type { BN } from '@polkadot/util';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import {
  AddressChip,
  AddressIcon,
  AddressLabel,
  QrScanner,
  Sheet,
} from '@/components/ui';
import {
  formatAge,
  useApi,
  useBalance,
  usePendingMultisigs,
  useStaleness,
  useTx,
} from '@/hooks';
import {
  useAccountsStore,
  useMultisigsStore,
  usePendingBytesStore,
} from '@/store';
import {
  decodeCall,
  extractTransferSummary,
  formatBalance,
  multisigAddressMatches,
  normalizeCallBytes,
  parseBytesPackage,
  shortenAddress,
  verifyCallHash,
  type DecodedCall,
} from '@/utils';

/**
 * Generous static weight for the inner call. The foundation's actual
 * usage measured on the live chain was {refTime: 146_841_000, proofSize: 3593}
 * (transferKeepAlive). We pass ~3x that to absorb any future runtime
 * changes without tx failures; the chain charges only for actual usage,
 * so over-quoting wastes nothing beyond the deposit reserve calculation
 * which is negligible for the foundation.
 *
 * A future improvement could compute this dynamically via paymentInfo on
 * the inner call (which requires reorganizing useTx to accept async builders).
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
  // Multisigs created by the guided two-device-approval wizard reframe the
  // spend flow as a 2-factor approval ("approve on your second device").
  // Cosmetic only — every verification gate and the signing path below are
  // identical regardless.
  const isTwoDevice = multisig.preset === 'two-device';
  const { accounts, activeAddress } = useAccountsStore();
  const { pending, isLoading: pendingLoading } = usePendingMultisigs(address);
  const stalenessOf = useStaleness();

  // Snapshot the proposal once we've seen it. The chain removes it from
  // storage the moment it executes (including via our own threshold-
  // meeting signature), so without a snapshot the screen flashes to
  // "proposal not found" right when the user is most expecting a
  // success confirmation. With the snapshot, we can render the success
  // sheet on top of the last-known proposal state instead.
  //
  // Tracked separately from `proposal` so the rest of the screen still
  // reflects fresh chain state during normal operation.
  const [snapshotProposal, setSnapshotProposal] = useState<
    typeof pending[number] | null
  >(null);
  const liveProposal = pending.find((p) => p.callHash === callHash);
  useEffect(() => {
    if (liveProposal) {
      setSnapshotProposal(liveProposal);
    }
  }, [liveProposal]);
  // Effective proposal: prefer the live one; fall back to the snapshot
  // when the live entry has disappeared (executed or cancelled). The
  // snapshot lets the success sheet render coherently after we've just
  // executed it ourselves.
  const proposalForRender = liveProposal ?? snapshotProposal;
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

  // The "proposal" we render details for. Always use proposalForRender
  // (snapshot-aware) for display. Only use `liveProposal` directly when
  // the chain's current state matters (e.g., the bounce-to-NotFound check).
  const proposal = proposalForRender;

  // Paste affordance state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Conscious-acknowledgement checkbox for the no-bytes path
  const [consciousAck, setConsciousAck] = useState(false);

  // Collapsibles
  const [bytesOpen, setBytesOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);

  // Confirmation sheet (password + submit) — for the APPROVE action
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Confirmation sheet (password + submit) — for the CANCEL action.
  // Cancel uses its own useTx instance so its lifecycle (signing,
  // finalized, error) doesn't collide with the approve action's
  // lifecycle. Each path is self-contained.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPassword, setCancelPassword] = useState('');
  const [cancelPasswordError, setCancelPasswordError] = useState<string | null>(
    null
  );
  const {
    submit: submitCancel,
    status: cancelStatus,
    error: cancelError,
    txHash: cancelTxHash,
    reset: resetCancel,
  } = useTx();
  const isCancelSubmitting =
    cancelStatus === 'signing' ||
    cancelStatus === 'broadcasting' ||
    cancelStatus === 'in-block';
  const isCancelDone = cancelStatus === 'finalized';

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

  // Compute the user's accounts that are signers of this multisig. Each
  // can have a DIFFERENT role on this specific proposal (one might be the
  // depositor, another might have already approved, a third might still
  // be able to sign). Per the multisig signer-picker rule, the user
  // explicitly chooses which of these accounts is acting on this screen
  // — never use activeAddress as the implicit signer.
  const eligibleSigners = useMemo(
    () =>
      accounts.filter((a) =>
        multisig.signers.some((s) => s.address === a.address)
      ),
    [accounts, multisig.signers]
  );

  // Default the picker to whichever eligible signer can still meaningfully
  // act on this proposal — i.e., a 'pending-approver'. Only fall back to
  // the active account or first-eligible if none of the user's signers
  // can still sign.
  const computeDefaultSigner = (): string => {
    if (!proposal) {
      return activeAddress &&
        eligibleSigners.some((a) => a.address === activeAddress)
        ? activeAddress
        : eligibleSigners[0]?.address ?? '';
    }
    const stillCanSign = eligibleSigners.find(
      (a) =>
        a.address !== proposal.depositor &&
        !proposal.approvals.includes(a.address)
    );
    if (stillCanSign) return stillCanSign.address;
    if (
      activeAddress &&
      eligibleSigners.some((a) => a.address === activeAddress)
    ) {
      return activeAddress;
    }
    return eligibleSigners[0]?.address ?? '';
  };

  const [signerAddress, setSignerAddress] = useState<string>(() =>
    computeDefaultSigner()
  );

  // Re-run the default when the proposal data first arrives or the
  // eligible set changes. Without this, the initial render runs with
  // proposal=undefined and we'd stick with whatever fallback we picked.
  const eligibleKey = eligibleSigners.map((a) => a.address).join('|');
  useEffect(() => {
    if (
      signerAddress &&
      eligibleSigners.some((a) => a.address === signerAddress)
    ) {
      return;
    }
    setSignerAddress(computeDefaultSigner());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey, proposal?.callHash]);

  const signerAccount = accounts.find((a) => a.address === signerAddress);

  // Pre-flight fee check. The signer pays the extrinsic fee from its OWN
  // account (separate from the multisig's balance), so a freshly-created
  // signer with no XX can't approve. Estimate the fee and warn before the
  // user signs, instead of letting the signature fail mid-broadcast.
  const { balance: signerBalance } = useBalance(signerAddress);
  const [estFee, setEstFee] = useState<BN | null>(null);
  useEffect(() => {
    if (!api || !callBytes || !proposal || !signerAddress) {
      setEstFee(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const innerCall = api.registry.createType('Call', hexToU8a(callBytes));
        const otherSignatories = multisig.signers
          .map((s) => s.address)
          .filter((a) => a !== signerAddress)
          .sort();
        const timepoint = {
          height: proposal.whenBlock,
          index: proposal.whenIndex,
        };
        const tx = api.tx.multisig.asMulti(
          multisig.threshold,
          otherSignatories,
          timepoint,
          innerCall,
          STATIC_INNER_CALL_WEIGHT
        );
        const info = await tx.paymentInfo(signerAddress);
        if (!cancelled) setEstFee(info.partialFee.toBn());
      } catch {
        if (!cancelled) setEstFee(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, callBytes, proposal?.callHash, signerAddress, multisig.threshold]);

  // Only a hard shortfall blocks — estFee null (still estimating) never blocks.
  const feeShortfall = !!(
    signerBalance &&
    estFee &&
    signerBalance.transferable.lt(estFee)
  );

  // The role of the SELECTED signer on this proposal. Different from the
  // pre-picker version (which used the active account); the picker may
  // change this on the fly.
  const userRole: UserRole = useMemo(() => {
    if (!signerAddress) return 'not-a-signer';
    if (!proposal) return 'not-a-signer';
    if (proposal.depositor === signerAddress) return 'depositor';
    if (proposal.approvals.includes(signerAddress)) return 'already-approved';
    return 'pending-approver';
  }, [signerAddress, proposal]);

  const hasEligibleSigner = eligibleSigners.length > 0;

  // Will the next approval execute? (At threshold-1 approvals, the next
  // signature finalizes the call.)
  const nextApprovalExecutes =
    proposal != null && proposal.approvals.length === multisig.threshold - 1;

  // Compute staleness for this proposal. Used to amp up the Cancel
  // affordance for depositors and surface a "this is stuck" note for
  // non-depositor cosigners (who can't cancel themselves but can ask).
  const staleness = proposal ? stalenessOf(proposal.whenBlock) : null;

  // Did we ever have this pending proposal? If `pending` finished loading
  // AND we've never snapshotted a copy of this proposal, it really doesn't
  // exist — bounce to NotFound. But if we DID have a snapshot (e.g., we
  // just signed the threshold-meeting approval and the chain removed the
  // proposal a moment ago), keep rendering the main view so the success
  // sheet can surface a clear "executed" confirmation.
  if (!pendingLoading && !proposal && !snapshotProposal) {
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
            <p className="text-xs text-ink-400">
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
  // Should be impossible given the import path validates this on
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

  /**
   * Unified input handler for paste / scan / file. Accepts either:
   *   - A full bytes-package JSON (the canonical format MultisigShare
   *     exports via file, QR, share-sheet, and copy-to-clipboard), OR
   *   - Raw call data hex (the lower-level format — power users who
     *     already extracted callData manually).
   *
   * Hash + address verification happens regardless of which format
   * arrives; the call bytes are only stored if they hash to the
   * on-chain call hash for THIS proposal and target THIS multisig.
   * Rejecting cross-proposal pastes (e.g., a package for a different
   * multisig or a different proposal) is part of the trust-
   * minimisation contract — the wallet refuses to render an
   * unverifiable approval.
   */
  const handleInput = (raw: string) => {
    setPasteError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setPasteError(
        'Paste call data hex or the full bytes-package JSON.'
      );
      return;
    }

    // Try as bytes-package JSON first.
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      // Not JSON; fall through to the raw-hex path.
    }
    if (parsedJson !== null) {
      const result = parseBytesPackage(parsedJson);
      if (result.ok) {
        const pkg = result.package;
        if (pkg.multisigAddress !== address) {
          setPasteError(
            `This bytes-package is for a different multisig (${shortenAddress(
              pkg.multisigAddress
            )}). This proposal is for ${shortenAddress(address)}.`
          );
          return;
        }
        if (pkg.callHash.toLowerCase() !== callHash.toLowerCase()) {
          setPasteError(
            'This bytes-package is for a different proposal — its call ' +
              'hash does not match this proposal. (parseBytesPackage already ' +
              'verified the package internally, but the hash inside does not ' +
              "match what's on chain here.)"
          );
          return;
        }
        putBytes({
          multisigAddress: address,
          callHash,
          callBytes: pkg.callData,
          source: 'received',
          receivedAt: Date.now(),
        });
        setPasted('');
        setPasteOpen(false);
        setScannerOpen(false);
        return;
      }
      // Valid JSON but not a valid package — surface the reason.
      setPasteError(
        `This is JSON but not a valid bytes-package: ${result.reason}`
      );
      return;
    }

    // Fallback: raw call-data hex.
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
    setScannerOpen(false);
  };

  const handlePaste = () => handleInput(pasted);

  const handleScan = (result: string) => handleInput(result);

  const handleFile = (file: File) => {
    setPasteError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setPasteError('Could not read file contents as text.');
        return;
      }
      handleInput(result);
    };
    reader.onerror = () =>
      setPasteError('Could not read the selected file.');
    reader.readAsText(file);
  };

  const handleApprove = () => {
    // Open the confirm sheet — password capture + submit happens there.
    resetTx();
    setPasswordError(null);
    setConfirmOpen(true);
  };

  const handleConfirmApprove = async () => {
    if (!signerAddress || !proposal || !callBytes) return;
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

          // other_signatories: every signer EXCEPT the picked signatory,
          // sorted SS58. We exclude based on the user-picked signer
          // (NOT activeAddress) per the multisig signer-picker rule.
          // Substrate sorts internally too, but we sort here for
          // consistency in case a future runtime change drops the
          // internal sort.
          const otherSignatories = multisig.signers
            .map((s) => s.address)
            .filter((a) => a !== signerAddress)
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
        { address: signerAddress, password }
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

  // ---------- CANCEL flow ----------
  // The depositor (and only the depositor — chain enforces) can cancel a
  // pending multisig proposal. Cancelling removes the proposal from
  // chain storage and returns the reserved deposit to the depositor.
  // Per design doc §6.4 + §11.1.

  const handleCancelTap = () => {
    resetCancel();
    setCancelPasswordError(null);
    setCancelOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!proposal || !signerAddress) return;
    setCancelPasswordError(null);
    try {
      await submitCancel(
        (api) => {
          // cancelAsMulti needs the same context as approve — same
          // signatory set, same timepoint, same call hash. Depositor
          // is the signer of the cancel extrinsic itself.
          const otherSignatories = multisig.signers
            .map((s) => s.address)
            .filter((a) => a !== signerAddress)
            .sort();
          const timepoint = {
            height: proposal.whenBlock,
            index: proposal.whenIndex,
          };
          return api.tx.multisig.cancelAsMulti(
            multisig.threshold,
            otherSignatories,
            timepoint,
            callHash
          );
        },
        { address: signerAddress, password: cancelPassword }
      );
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('unable to decode') ||
        msg.toLowerCase().includes('incorrect')
      ) {
        setCancelPasswordError('Incorrect password. Please try again.');
      }
    }
  };

  const closeCancelConfirm = () => {
    if (isCancelSubmitting) return;
    setCancelOpen(false);
    setCancelPassword('');
    setCancelPasswordError(null);
    resetCancel();
  };

  const closeCancelSuccess = () => {
    // Cancel succeeded — the proposal is gone from chain and the
    // depositor's deposit has been returned. Cached bytes are no
    // longer useful for this proposal; remove them.
    if (callBytes) removeBytes(address, callHash);
    resetCancel();
    setCancelOpen(false);
    navigate(`/multisig/${address}`, { replace: true });
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
      <TopBar
        title={isTwoDevice ? 'Approve spend' : 'Approve proposal'}
        showBack
      />
      <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
        {/* Header: which multisig + role context */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-xx-500" strokeWidth={2.25} />
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              {multisig.localName}
            </p>
            <span className="text-xs text-ink-400">
              {isTwoDevice
                ? '· two-device approval'
                : `· ${multisig.threshold}-of-${multisig.signers.length}`}
            </span>
          </div>
          <RoleBanner
            role={userRole}
            isTwoDevice={isTwoDevice}
            nextApprovalExecutes={nextApprovalExecutes}
          />
          {isTwoDevice &&
            (userRole === 'pending-approver' || userRole === 'depositor') && (
              <p className="text-xs text-ink-400 leading-relaxed">
                This is the second factor protecting these funds — the spend was
                started on one device and needs a second device to approve
                before it can go through.
              </p>
            )}
        </div>

        {/* Signer picker — which of YOUR accounts is acting on this
            proposal. Different of your accounts may have different roles
            here (one might be the depositor, another might still be able
            to sign), so this is consequential. */}
        {hasEligibleSigner && (
          <div className="card space-y-2">
            <div className="flex items-center gap-2">
              <Key size={14} className="text-xx-500" strokeWidth={2.25} />
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Acting as
              </p>
            </div>
            {eligibleSigners.length === 1 ? (
              <div className="flex items-center gap-2">
                <AddressIcon
                  address={eligibleSigners[0].address}
                  size={28}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">
                    {eligibleSigners[0].name}
                  </p>
                  <p className="font-mono text-xs text-ink-400 truncate">
                    {eligibleSigners[0].address}
                  </p>
                </div>
              </div>
            ) : (
              <select
                value={signerAddress}
                onChange={(e) => setSignerAddress(e.target.value)}
                className="input-base text-sm"
              >
                {eligibleSigners.map((a) => {
                  let suffix = '';
                  if (proposal) {
                    if (a.address === proposal.depositor) suffix = ' (depositor)';
                    else if (proposal.approvals.includes(a.address))
                      suffix = ' (already signed)';
                  }
                  return (
                    <option key={a.address} value={a.address}>
                      {a.name} — {a.address.slice(0, 8)}…
                      {a.address.slice(-6)}
                      {suffix}
                    </option>
                  );
                })}
              </select>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-ink-400 leading-relaxed">
                Signs the approval and pays the network fee from its own
                balance.
              </p>
              {signerBalance && (
                <p
                  className={clsx(
                    'text-xs font-mono numeric flex-shrink-0',
                    feeShortfall ? 'text-danger' : 'text-ink-300'
                  )}
                >
                  {formatBalance(signerBalance.transferable, { decimals: 4 })} XX
                </p>
              )}
            </div>
            {feeShortfall && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-danger/10 border border-danger/30">
                <AlertTriangle
                  size={14}
                  className="text-danger flex-shrink-0 mt-0.5"
                />
                <p className="text-xs text-ink-200 leading-snug">
                  This account can't cover the network fee
                  {estFee ? (
                    <> (needs ≈{formatBalance(estFee, { decimals: 4 })} XX)</>
                  ) : null}
                  . Add a little XX to it before signing — signer accounts pay
                  fees from their own balance. Tip: keep ≈5 XX in each signer
                  for fees.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Description — the central UX moment */}
        {bytesAvailable && hashVerified && decoded && (
          <DecodedDescriptionCard
            decoded={decoded}
            source={cachedEntry?.source ?? 'received'}
          />
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
            onOpenScanner={() => setScannerOpen(true)}
            onOpenFile={() => fileInputRef.current?.click()}
            pasteOpen={pasteOpen}
          />
        )}

        {/* Hidden file input — opened by the "Open file" button in the
            NoBytesCard. Accepts the bytes-package JSON file that
            MultisigShare exports via Save / Download. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Reset so picking the same file again still fires onChange.
            e.target.value = '';
          }}
        />

        {/* Paste affordance */}
        {pasteOpen && (
          <div className="card space-y-2">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Paste call data or bytes-package
            </p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'0x… or {"format":"xx-wallet-multisig-bytes-package",…}'}
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
            <p className="text-xs text-ink-400 leading-relaxed">
              Accepts either raw call-data hex or the full bytes-package
              JSON the proposer shared. The wallet will hash the call
              data locally and confirm it matches the on-chain call hash
              before showing the decoded action. Anything that doesn't
              match is rejected, not displayed.
            </p>
          </div>
        )}

        {/* Proposal metadata: who proposed, when */}
        {proposal && (
          <div className="card space-y-2">
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Proposal details
            </p>
            {/* Depositor row uses AddressLabel so we get the name +
                fragment instead of just an obscure truncated SS58. */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-400">Proposed by</span>
              <AddressLabel
                address={proposal.depositor}
                className="text-sm"
              />
            </div>
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
                    {/* Per-signer row — AddressLabel resolves the
                        best-available name (own account → contact →
                        multisig nickname → fallback to fragment). The
                        signer's local label still wins if it's set on
                        the multisig record (most-specific source). */}
                    <span
                      className={clsx(
                        'truncate',
                        hasApproved ? 'text-ink-200' : 'text-ink-300'
                      )}
                    >
                      {s.label ? (
                        <>
                          <span className="font-medium">{s.label}</span>{' '}
                          <span className="font-mono text-xs text-ink-400">
                            [{shortenAddress(s.address)}]
                          </span>
                        </>
                      ) : (
                        <AddressLabel address={s.address} />
                      )}
                    </span>
                    {s.address === proposal.depositor && (
                      <span className="text-xs uppercase tracking-wider text-ink-400 ml-auto">
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
            <p className="font-mono text-xs text-ink-200 break-all leading-relaxed select-all">
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
              <p className="font-mono text-xs text-ink-400 break-all pt-1">
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
                (!bytesAvailable && !consciousAck) ||
                feeShortfall
              }
              className={clsx(
                'btn-primary w-full',
                ((bytesAvailable && !hashVerified) ||
                  (!bytesAvailable && !consciousAck) ||
                  feeShortfall) &&
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

          {/* Stale-proposal note for non-depositor cosigners. They can't
              cancel themselves (chain enforces depositor-only), but they
              CAN nudge the depositor to clean it up. A notification channel
              could later offer a one-tap nudge; for now this is
              informational. */}
          {(userRole === 'pending-approver' ||
            userRole === 'already-approved') &&
            staleness?.isStale &&
            proposal && (
              <div className="card border border-amber-500/30 bg-amber-500/5 space-y-1.5">
                <p className="text-xs font-medium text-amber-300">
                  Stale — pending for {formatAge(staleness.ageDays)}
                </p>
                <p className="text-xs text-ink-300 leading-snug">
                  Only the proposer ({shortenAddress(proposal.depositor)})
                  can cancel this. If it's no longer wanted, ask them to
                  cancel and reclaim the{' '}
                  <span className="text-ink-200 numeric">
                    {formatBalance(proposal.deposit)} XX
                  </span>{' '}
                  deposit they put up.
                </p>
              </div>
            )}
          {userRole === 'depositor' && (
            <>
              <div
                className={clsx(
                  'card text-xs leading-relaxed space-y-2',
                  staleness?.isStale
                    ? 'border-amber-500/40 bg-amber-500/5 text-ink-200'
                    : 'text-ink-300'
                )}
              >
                {staleness?.isStale ? (
                  <p className="text-amber-300 font-medium">
                    This proposal has been pending for{' '}
                    {formatAge(staleness.ageDays)} — past the stale
                    threshold.
                  </p>
                ) : (
                  <p>
                    You proposed this. The proposal stays on chain until
                    enough cosigners approve, OR until you cancel it.
                  </p>
                )}
                {proposal && (
                  <p className="text-ink-400">
                    Cancelling refunds the{' '}
                    <span className="text-ink-300 numeric">
                      {formatBalance(proposal.deposit)} XX
                    </span>{' '}
                    deposit you put up when you proposed.
                  </p>
                )}
              </div>
              {/* Re-open the share screen for this pending proposal. The call
                  bytes were cached locally at propose time (and persist), so
                  the proposer can bring the QR / file / copy back up any time
                  before it executes or is cancelled — not only right after
                  proposing. */}
              {bytesAvailable && (
                <button
                  onClick={() =>
                    navigate(`/multisig/${address}/share/${callHash}`)
                  }
                  className="btn-primary w-full"
                >
                  <Send size={16} strokeWidth={2} />
                  {isTwoDevice
                    ? 'Send to your second device'
                    : 'Share call data with cosigners'}
                </button>
              )}
              <button
                onClick={handleCancelTap}
                className={clsx(
                  'w-full',
                  staleness?.isStale
                    ? 'btn-primary bg-amber-500 text-ink-950 active:bg-amber-600'
                    : 'btn-secondary text-danger border-danger/30 active:bg-danger/10'
                )}
              >
                <X size={16} strokeWidth={2} />
                {staleness?.isStale && proposal
                  ? `Cancel & reclaim ${formatBalance(proposal.deposit)} XX`
                  : 'Cancel proposal'}
              </button>
            </>
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
        title={
          nextApprovalExecutes
            ? isTwoDevice
              ? 'Confirm & release funds'
              : 'Confirm and execute'
            : 'Confirm approval'
        }
      >
        <div className="space-y-4">
          <div className="space-y-3 p-4 rounded-2xl bg-ink-800 border border-ink-700/50">
            <Row label="Multisig">
              <span className="font-medium text-sm">{multisig.localName}</span>
            </Row>
            <Row label="Signed by">
              <span className="font-medium text-sm">
                {signerAccount?.name ?? 'unknown'}
              </span>
            </Row>
            <Row label="Action">
              {(() => {
                // Mirror the main screen's amount-prominent rendering
                // here on the final-confirmation step — same anti-extra-
                // zero principle. The user is one tap away from signing;
                // the amount must be impossible to misread.
                const transfer = decoded ? extractTransferSummary(decoded) : null;
                if (transfer) {
                  return (
                    <div className="text-right">
                      <p className="text-lg font-display font-medium text-ink-100 numeric leading-tight">
                        {transfer.formattedAmount}{' '}
                        <span className="text-sm text-ink-300">
                          {transfer.symbol}
                        </span>
                      </p>
                      <p className="font-mono text-xs text-ink-400 break-all leading-tight">
                        to {transfer.recipient}
                      </p>
                    </div>
                  );
                }
                return (
                  <span className="text-sm text-ink-100 leading-snug whitespace-pre-line">
                    {decoded?.friendly ?? decoded?.literal ?? '(no decoded view)'}
                  </span>
                );
              })()}
            </Row>
            <Row label="Effect">
              <span className="text-xs text-ink-300 leading-snug">
                {nextApprovalExecutes
                  ? isTwoDevice
                    ? 'This is your second-device approval — it releases the funds from your protected account immediately.'
                    : 'Your approval will be the threshold-meeting signature; the inner action will execute on chain immediately.'
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

      {/* Success sheet — content depends on whether this approval was
          the threshold-meeting signature (executed the inner call) or
          an intermediate signature (proposal still pending). For
          executed transfers, mirror the same prominent amount/recipient
          display the user just confirmed, so they get an unmistakable
          "this is what just happened on chain" view. */}
      <Sheet open={isDone} onClose={closeSuccess}>
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-xx-500/10 border border-xx-500/40 flex items-center justify-center">
            <Check size={32} className="text-xx-500" strokeWidth={2} />
          </div>

          <div>
            <h2 className="font-display font-semibold text-xl">
              {nextApprovalExecutes
                ? isTwoDevice
                  ? 'Funds released'
                  : 'Transfer executed'
                : 'Approval recorded'}
            </h2>
            <p className="text-sm text-ink-400 mt-1 leading-relaxed">
              {nextApprovalExecutes
                ? isTwoDevice
                  ? 'Both devices approved. The transfer has executed on chain — funds have moved out of your protected account.'
                  : 'Threshold met. The transfer has executed on chain — funds have moved out of the multisig.'
                : `Your signature is on chain. ${
                    multisig.threshold - ((proposal?.approvals.length ?? 0) + 1)
                  } more signature(s) needed before the transfer executes.`}
            </p>
          </div>

          {/* Prominent amount + recipient — only when we executed AND we
              have a decoded transfer to show. Same visual treatment as
              the approval card so the user sees a clear, unambiguous
              confirmation of what just happened. */}
          {nextApprovalExecutes && decoded && (() => {
            const transfer = extractTransferSummary(decoded);
            if (!transfer) return null;
            return (
              <div className="w-full p-4 rounded-2xl bg-xx-500/5 border border-xx-500/30 space-y-2 text-left">
                <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                  Sent
                </p>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-3xl font-display font-medium text-ink-100 numeric leading-none">
                    {transfer.formattedAmount}
                  </span>
                  <span className="text-base text-ink-300 font-display font-medium">
                    {transfer.symbol}
                  </span>
                </div>
                <div className="pt-1">
                  <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                    To
                  </p>
                  <p className="font-mono text-xs text-ink-200 break-all leading-snug">
                    {transfer.recipient}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* For intermediate (non-executing) signatures, show the
              progress meter so the user understands the proposal's
              new state at a glance. */}
          {!nextApprovalExecutes && proposal && (
            <div className="w-full p-3 rounded-xl bg-ink-800 border border-ink-700/50 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-400">Approvals</span>
                <span className="text-ink-100 font-medium numeric">
                  {(proposal.approvals.length + 1)} of {multisig.threshold}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
                <div
                  className="h-full bg-xx-500 transition-all"
                  style={{
                    width: `${
                      ((proposal.approvals.length + 1) / multisig.threshold) *
                      100
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

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

      {/* Cancel confirm sheet — for the depositor's "remove this proposal
          from chain and reclaim the deposit" action. Independent useTx
          state from the approve flow so the two paths don't collide. */}
      <Sheet
        open={cancelOpen && !isCancelDone}
        onClose={closeCancelConfirm}
        title="Cancel proposal"
      >
        <div className="space-y-4">
          <div className="space-y-3 p-4 rounded-2xl bg-ink-800 border border-ink-700/50">
            <Row label="Multisig">
              <span className="font-medium text-sm">{multisig.localName}</span>
            </Row>
            <Row label="Cancelled by">
              <span className="font-medium text-sm">
                {signerAccount?.name ?? 'unknown'}
              </span>
            </Row>
            <Row label="Action removed">
              <span className="text-sm text-ink-100 leading-snug whitespace-pre-line">
                {decoded?.friendly ?? decoded?.literal ?? '(no decoded view)'}
              </span>
            </Row>
            {proposal && (
              <Row label="Deposit returned">
                <span className="font-mono text-sm text-ink-100 numeric">
                  {formatBalance(proposal.deposit)} XX
                </span>
              </Row>
            )}
            <Row label="Effect">
              <span className="text-xs text-ink-300 leading-snug">
                The proposal is removed from chain storage. The reserved
                deposit is returned to your account. Cosigners can no
                longer approve it — they'll see the proposal disappear
                from their pending list.
              </span>
            </Row>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={cancelPassword}
              onChange={(e) => {
                setCancelPassword(e.target.value);
                setCancelPasswordError(null);
              }}
              className="input-base"
              placeholder="Enter your wallet password to sign"
              autoComplete="current-password"
              disabled={isCancelSubmitting}
            />
            {cancelPasswordError && (
              <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
                <AlertTriangle size={12} />
                {cancelPasswordError}
              </p>
            )}
          </div>

          {cancelError && !cancelPasswordError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
              <AlertTriangle
                size={16}
                className="text-danger flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="font-medium mb-0.5">Cancel failed</p>
                <p className="text-xs text-ink-300 break-all">
                  {cancelError.message}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirmCancel}
            disabled={isCancelSubmitting || !cancelPassword}
            className="btn-primary w-full bg-danger text-white active:bg-danger/80"
          >
            {isCancelSubmitting && (
              <Loader2 size={16} className="animate-spin" />
            )}
            {isCancelSubmitting
              ? cancelStatus === 'signing'
                ? 'Signing…'
                : cancelStatus === 'broadcasting'
                ? 'Sending to network…'
                : 'Waiting for finality…'
              : 'Confirm cancellation'}
          </button>
        </div>
      </Sheet>

      {/* Cancel success sheet */}
      <Sheet open={isCancelDone} onClose={closeCancelSuccess}>
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-ink-700/40 border border-ink-600/40 flex items-center justify-center">
            <X size={32} className="text-ink-300" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-xl">
              Proposal cancelled
            </h2>
            <p className="text-sm text-ink-400 mt-1 leading-relaxed">
              The proposal has been removed from chain storage.
              {proposal && (
                <>
                  {' '}Your{' '}
                  <span className="text-ink-200 numeric">
                    {formatBalance(proposal.deposit)} XX
                  </span>{' '}
                  deposit has been returned.
                </>
              )}
            </p>
          </div>
          {cancelTxHash && (
            <div className="w-full">
              <p className="text-xs text-ink-400 mb-1 uppercase tracking-wide">
                Transaction hash
              </p>
              <AddressChip address={cancelTxHash} shortened className="w-full" />
            </div>
          )}
          <button
            onClick={closeCancelSuccess}
            className="btn-primary w-full mt-2"
          >
            Done
          </button>
        </div>
      </Sheet>

      {/* QR scanner full-screen takeover — opened from the NoBytesCard's
          Scan QR button. Scans the bytes-package QR that MultisigShare
          generates; the same handleInput pipeline validates and stores
          the result. */}
      {scannerOpen && (
        <QrScanner
          onScan={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
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

function RoleBanner({
  role,
  isTwoDevice,
  nextApprovalExecutes,
}: {
  role: UserRole;
  isTwoDevice: boolean;
  nextApprovalExecutes: boolean;
}) {
  const text = (() => {
    if (isTwoDevice) {
      switch (role) {
        case 'pending-approver':
          return nextApprovalExecutes
            ? 'Approve from your second device to release these funds.'
            : 'Approve this spend from your second device.';
        case 'depositor':
          return 'You started this spend. Approve it from your second device to release the funds.';
        case 'already-approved':
          return "You've approved from this device. Waiting on your other device.";
        case 'not-a-signer':
          return "You're not a signer on this protected account.";
      }
    }
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

function DecodedDescriptionCard({
  decoded,
  source,
}: {
  decoded: DecodedCall;
  /** Where the call data came from, so the user understands why they
   *  weren't asked to paste it (or, conversely, that it's bytes they
   *  themselves pasted). Doesn't affect security — both sources are
   *  hash-verified before reaching here — but it's clarifying context. */
  source: 'self-proposed' | 'received';
}) {
  // For transfer calls, render the amount with strong visual prominence
  // so the user can't miss an extra zero (the most common amount-related
  // social-engineering attack). For all other call types, fall back to
  // the friendly text description.
  const transfer = extractTransferSummary(decoded);

  return (
    <div className="card space-y-3 border border-xx-500/30 bg-xx-500/5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-xx-500" strokeWidth={2.25} />
        <p className="text-xs uppercase tracking-wider text-xx-500 font-medium">
          Decoded by your wallet from verified call data
        </p>
      </div>

      {transfer ? (
        <TransferProminentDisplay transfer={transfer} />
      ) : (
        <FreeTextDescription decoded={decoded} />
      )}

      {/* Source attribution — explains where the call data came from.
          Subtle, informational; the security gate is hash verification
          regardless of source, so this is for clarity not for trust. */}
      <p className="text-xs text-ink-400 leading-snug pt-1 border-t border-ink-700/40">
        {source === 'self-proposed' ? (
          <>
            Source: <span className="text-ink-400">You proposed this from this wallet.</span> The
            call data was cached locally when you submitted; no manual
            paste was needed. Cosigners on other devices will need to
            receive it from you.
          </>
        ) : (
          <>
            Source: <span className="text-ink-400">Call data you pasted into this wallet.</span> The
            wallet has hash-verified it against the on-chain hash before
            decoding.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The amount-prominent rendering for transfer calls. Designed to make
 * the magnitude of the transfer impossible to miss — the number is
 * rendered large with explicit thousand separators, and the recipient
 * is on a separate line below so the eye reads them as two distinct
 * pieces of information rather than one run-on sentence.
 *
 * The "Sending" / "to" labels are intentionally subordinate — the
 * value itself is what the user must read carefully. Anti-extra-zero
 * scams: at this size and with grouping, 1,000,000 vs 10,000,000 is
 * impossible to confuse at a glance.
 */
function TransferProminentDisplay({
  transfer,
}: {
  transfer: ReturnType<typeof extractTransferSummary> & object;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
        Sending
      </p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-3xl font-display font-medium text-ink-100 numeric leading-none">
          {transfer.formattedAmount}
        </span>
        <span className="text-base text-ink-300 font-display font-medium">
          {transfer.symbol}
        </span>
      </div>
      <div className="pt-1 space-y-1">
        <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
          To
        </p>
        {/* AddressLabel renders the name (own account / contact /
            multisig) if known, plus the truncated address fragment.
            Always the fragment too — never just a name, per the
            decoder's no-misleading-substitution rule. */}
        <AddressLabel address={transfer.recipient} stacked />
        <p className="font-mono text-xs text-ink-400 break-all leading-snug pt-1">
          {transfer.recipient}
        </p>
      </div>
    </div>
  );
}

function FreeTextDescription({ decoded }: { decoded: DecodedCall }) {
  const description = decoded.friendly ?? decoded.literal;
  const isFriendly = decoded.friendly !== null;
  return (
    <>
      <p className="text-base text-ink-100 leading-snug whitespace-pre-line">
        {description}
      </p>
      {!isFriendly && (
        <p className="text-xs text-amber-300 leading-snug">
          This call type is not specifically recognized by the wallet —
          the description above is the literal pallet method and
          arguments. Read carefully before approving.
        </p>
      )}
    </>
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
      <p className="text-xs text-ink-300 leading-snug">{message}</p>
      <p className="text-xs text-ink-400 leading-snug">
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
      <p className="text-xs text-ink-300 leading-snug">
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
  onOpenScanner,
  onOpenFile,
  pasteOpen,
}: {
  consciousAck: boolean;
  onAckChange: (v: boolean) => void;
  onOpenPaste: () => void;
  onOpenScanner: () => void;
  onOpenFile: () => void;
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
      <p className="text-xs text-ink-200 leading-relaxed">
        Your wallet cannot show what this proposal does. Approving
        without seeing the decoded action means trusting the proposer's
        description from another channel. Get the call-data bytes
        package from the proposer (file, QR, or paste) and load it
        below — the wallet will verify it matches this proposal's
        on-chain call hash before showing the decoded action.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onOpenFile}
          className="btn-secondary text-xs flex-col py-3"
        >
          <Upload size={16} strokeWidth={2} />
          Open file
        </button>
        <button
          onClick={onOpenScanner}
          className="btn-secondary text-xs flex-col py-3"
        >
          <ScanLine size={16} strokeWidth={2} />
          Scan QR
        </button>
        <button
          onClick={onOpenPaste}
          className="btn-secondary text-xs flex-col py-3"
        >
          <Clipboard size={16} strokeWidth={2} />
          {pasteOpen ? 'Hide paste' : 'Paste'}
        </button>
      </div>
      <label className="flex items-start gap-2 text-xs text-ink-300 leading-snug cursor-pointer select-none">
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
        className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-ink-400 font-medium"
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
