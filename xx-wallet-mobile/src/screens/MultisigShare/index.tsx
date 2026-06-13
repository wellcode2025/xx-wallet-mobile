/**
 * MultisigShare — distribute the call data of a freshly-proposed multisig
 * to other cosigners.
 *
 * Reached after MultisigPropose succeeds (or by re-opening a proposal
 * the user has cached bytes for, via the "share again" affordance).
 *
 * Three first-class share affordances — none of them
 * "fallbacks", all expected to be used in real workflows:
 *   1. Download as .json file (PRIMARY, most flexible — the user picks
 *      whatever secure channel they trust to deliver the file)
 *   2. QR code rendering for in-person handoffs
 *   3. Native share sheet via navigator.share (one-tap forwarding to any
 *      app the device has set up — Signal, Mail, Files, etc.)
 *
 * The wallet does NOT try to be the secure delivery channel itself.
 * Any of these three lets the user hand off the bytes-package JSON;
 * the receiving wallet's parseBytesPackage validates everything before
 * surfacing the proposal for approval.
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  Loader2,
  QrCode,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import QRCode from 'qrcode';
import { TopBar } from '@/components/layout';
import { AddressLabel } from '@/components/ui';
import { useApi, usePendingMultisigs } from '@/hooks';
import { useMultisigsStore, usePendingBytesStore } from '@/store';
import {
  buildBytesPackage,
  copyToClipboard,
  decodeCall,
  extractTransferSummary,
  serializeBytesPackage,
  type DecodedCall,
} from '@/utils';

export function MultisigShare() {
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
  return <ShareView address={address} callHash={callHash.toLowerCase()} />;
}

function ShareView({
  address,
  callHash,
}: {
  address: string;
  callHash: string;
}) {
  const navigate = useNavigate();
  const multisig = useMultisigsStore((s) => s.getMultisig(address))!;
  // Accounts created by the two-device-approval wizard reframe this hand-off
  // as "send to your second device" rather than "share with cosigners".
  const isTwoDevice = multisig.preset === 'two-device';
  const cachedEntry = usePendingBytesStore((s) =>
    s.getBytes(address, callHash)
  );
  const { pending } = usePendingMultisigs(address);
  const api = useApi();

  // Find the on-chain proposal so we can include the (block, index)
  // timepoint in the bytes-package — cosigners need it to construct
  // their approve_as_multi extrinsic.
  const proposal = pending.find((p) => p.callHash === callHash);

  // Build the bytes-package once we have everything we need.
  const bytesPackage = useMemo(() => {
    if (!cachedEntry || !proposal) return null;
    try {
      return buildBytesPackage({
        multisigAddress: address,
        callHash,
        callData: cachedEntry.callBytes,
        proposedBy: proposal.depositor,
        proposedAt: { block: proposal.whenBlock, index: proposal.whenIndex },
      });
    } catch {
      return null;
    }
  }, [cachedEntry, proposal, address, callHash]);

  const packageJson = useMemo(
    () => (bytesPackage ? serializeBytesPackage(bytesPackage) : ''),
    [bytesPackage]
  );

  // Decode the call for the summary at the top — same friendly rendering
  // as the approval flow, so the proposer sees the same description their
  // cosigners will see.
  const [decoded, setDecoded] = useState<DecodedCall | null>(null);
  useEffect(() => {
    if (!cachedEntry || !api) {
      setDecoded(null);
      return;
    }
    try {
      setDecoded(decodeCall(cachedEntry.callBytes, api));
    } catch {
      setDecoded(null);
    }
  }, [cachedEntry, api]);

  // Pre-render the QR code so it's ready when the user expands the QR
  // affordance (snappier UX than a flash-of-loading on toggle).
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!packageJson) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(packageJson, {
      errorCorrectionLevel: 'M',
      margin: 2,
      // 320px renders crisply on phone screens without overflowing the
      // card. Larger sizes don't scale gracefully on narrow viewports.
      width: 320,
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [packageJson]);

  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const fileName = `multisig-call-${callHash.slice(2, 10)}.json`;

  const handleDownload = () => {
    setShareError(null);
    if (!packageJson) return;
    try {
      const blob = new Blob([packageJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a short delay so the download has a chance to grab
      // the URL (some browsers race here).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setShareError(`Download failed: ${(e as Error).message}`);
    }
  };

  const handleCopy = async () => {
    setShareError(null);
    if (!packageJson) return;
    const ok = await copyToClipboard(packageJson);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setShareError('Could not copy — try the download option instead.');
    }
  };

  const handleShareSheet = async () => {
    setShareError(null);
    if (!packageJson) return;
    try {
      // Prefer file-based share when available — the receiver's app
      // gets the .json directly with the right MIME type. Falls back
      // to text share when files aren't supported.
      const blob = new Blob([packageJson], { type: 'application/json' });
      const file = new File([blob], fileName, { type: 'application/json' });
      const navWithCanShare = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (
        navWithCanShare.canShare &&
        navWithCanShare.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: 'Multisig call data',
          text: `Call data for multisig proposal at ${address.slice(0, 8)}…`,
        });
      } else if (navigator.share) {
        await navigator.share({
          title: 'Multisig call data',
          text: packageJson,
        });
      } else {
        setShareError(
          'Share sheet not available in this browser. Use Download or Copy instead.'
        );
      }
    } catch (e) {
      // navigator.share throws on user cancellation — distinguish that
      // from real errors so we don't show a scary message.
      const msg = (e as Error).message ?? '';
      if (!/abort|cancel/i.test(msg)) {
        setShareError(`Share failed: ${msg}`);
      }
    }
  };

  // Defensive: if we lost the cached bytes (e.g., browser data cleared
  // mid-flow), bounce back to the multisig detail.
  if (!cachedEntry) {
    return (
      <>
        <TopBar title="Share" showBack />
        <div className="px-5 py-6 max-w-md mx-auto">
          <div className="card text-center space-y-2">
            <AlertTriangle
              size={32}
              className="text-amber-400 mx-auto"
              strokeWidth={1.5}
            />
            <p className="text-sm text-ink-200">
              No cached call data for this proposal.
            </p>
            <p className="text-xs text-ink-300">
              The bytes may have been cleared. You can still see the
              proposal under {multisig.localName}, but you'll need a
              cosigner to share their copy of the call data.
            </p>
            <button
              onClick={() => navigate(`/multisig/${address}`, { replace: true })}
              className="btn-primary w-full mt-3"
            >
              Back to {multisig.localName}
            </button>
          </div>
        </div>
      </>
    );
  }

  const stillBuilding = !bytesPackage || !packageJson;

  return (
    <>
      <TopBar
        title={isTwoDevice ? 'Send to your second device' : 'Share with cosigners'}
        showBack
      />
      <div className="px-5 py-6 max-w-md mx-auto space-y-4 pb-24">
        {/* Context */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-xx-500" strokeWidth={2.25} />
            <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
              {multisig.localName}
            </p>
          </div>
          <h1 className="text-lg font-display font-medium text-ink-100 leading-snug">
            {isTwoDevice
              ? 'Open this on your second device'
              : 'Send this to your cosigners'}
          </h1>
          <p className="text-xs text-ink-300 leading-relaxed">
            {isTwoDevice
              ? 'Your second device will show the same decoded action below, where one approval releases the funds. The quickest way is to scan the QR code with it.'
              : "They'll import it into their wallet, see the same decoded action you see below, and can approve once" +
                (multisig.threshold > 1
                  ? ` (you need ${multisig.threshold - 1} more signature${
                      multisig.threshold - 1 !== 1 ? 's' : ''
                    })`
                  : '') +
                '.'}
          </p>
        </div>

        {/* Action summary — matches the prominent rendering cosigners
            will see in their approval flow. Same anti-extra-zero design:
            amount large + grouped, recipient on its own line. */}
        <div className="card space-y-3 border border-xx-500/30 bg-xx-500/5">
          <div className="flex items-center gap-2">
            <ShieldCheck
              size={14}
              className="text-xx-500"
              strokeWidth={2.25}
            />
            <p className="text-xs uppercase tracking-wider text-xx-500 font-medium">
              {isTwoDevice
                ? 'Action your second device will see'
                : 'Action your cosigners will see'}
            </p>
          </div>
          {decoded ? (
            (() => {
              const transfer = extractTransferSummary(decoded);
              if (transfer) {
                return (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
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
                      <p className="text-xs uppercase tracking-wider text-ink-300 font-medium">
                        To
                      </p>
                      <AddressLabel
                        address={transfer.recipient}
                        stacked
                        className="text-sm"
                      />
                      {/* Always show the raw address too — name substitution
                          must never hide what's actually being signed. When
                          there's no nickname, AddressLabel already renders the
                          fragment, so this would duplicate; only render when
                          a name is present (i.e. AddressLabel rendered the
                          name + small fragment, and we want the full address
                          available for verification). */}
                      <p className="font-mono text-xs text-ink-300 break-all leading-snug">
                        {transfer.recipient}
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <p className="text-base text-ink-100 leading-snug whitespace-pre-line">
                  {decoded.friendly ?? decoded.literal}
                </p>
              );
            })()
          ) : (
            <p className="text-sm text-ink-300">Decoding…</p>
          )}
        </div>

        {stillBuilding && (
          <div className="card text-xs text-ink-300 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Building share package…
          </div>
        )}

        {/* Three first-class share paths */}
        {!stillBuilding && (
          <div className="space-y-3">
            {/* PRIMARY: file download */}
            <button onClick={handleDownload} className="btn-primary w-full">
              <Download size={16} strokeWidth={2} />
              Download as file
            </button>
            <p className="text-xs text-ink-300 leading-relaxed -mt-1 px-1">
              {isTwoDevice ? (
                <>
                  Saves a <code>{fileName}</code> file you can get to your
                  second device (AirDrop, email to yourself, or any channel
                  you trust).
                </>
              ) : (
                <>
                  Recommended. Saves a <code>{fileName}</code> file you can
                  share via Signal, email, AirDrop, or any channel you trust.
                </>
              )}
            </p>

            {/* QR code (collapsible — saves vertical space when not in use) */}
            <button
              onClick={() => setQrOpen((o) => !o)}
              className="btn-secondary w-full"
            >
              <QrCode size={16} strokeWidth={2} />
              {qrOpen ? 'Hide QR code' : 'Show QR code'}
            </button>
            {qrOpen && (
              <div className="card flex flex-col items-center space-y-2 bg-white">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Multisig call data QR code"
                    className="w-full max-w-[280px] h-auto"
                  />
                ) : (
                  <div className="w-[280px] h-[280px] flex items-center justify-center text-ink-300 text-xs">
                    Generating…
                  </div>
                )}
                <p className="text-xs text-ink-700 text-center leading-relaxed px-2 pb-1">
                  {isTwoDevice
                    ? 'Scan this with your second device to load the spend, then approve there.'
                    : 'Have your cosigner scan this with their wallet. Best for in-person handoffs.'}
                </p>
              </div>
            )}

            {/* Native share sheet */}
            <button onClick={handleShareSheet} className="btn-secondary w-full">
              <Send size={16} strokeWidth={2} />
              Share via…
            </button>

            {/* Copy fallback — useful for paste-into-Slack-style workflows */}
            <button onClick={handleCopy} className="btn-secondary w-full">
              {copied ? (
                <Check size={16} className="text-xx-500" strokeWidth={2.25} />
              ) : (
                <Clipboard size={16} strokeWidth={2} />
              )}
              {copied ? 'Copied' : 'Copy as text'}
            </button>

            {shareError && (
              <p className="text-xs text-danger leading-snug px-1">
                {shareError}
              </p>
            )}
          </div>
        )}

        {/* Done */}
        <button
          onClick={() => navigate(`/multisig/${address}`, { replace: true })}
          className="btn-secondary w-full mt-4"
        >
          Done
        </button>

        <p className="text-xs text-ink-300 text-center leading-relaxed">
          The proposal is on chain regardless of how (or if) you share —
          you can always come back to share later by reopening the
          proposal from {multisig.localName}.
        </p>
      </div>
    </>
  );
}
