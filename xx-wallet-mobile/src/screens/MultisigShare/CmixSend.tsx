/**
 * CmixSend — deliver a freshly-proposed multisig call to cosigners directly
 * over the xx mixnet, instead of passing a file/QR around by hand.
 *
 * Only usable once the device is online for coordination (the per-device cMix
 * identity is unlocked) AND at least one cosigner has a registered contact —
 * both set up from the multisig's "Cosigner messaging" section. When either is
 * missing this collapses to a compact hint that points there; it never competes
 * with the always-available manual share options.
 *
 * The memo is transport, not instruction: it carries the hash-gated bytes
 * package, which the receiving wallet re-validates against the call hash before
 * surfacing anything for approval (the §6.4 invariant). Delivery is per-cosigner
 * and best-effort — the underlying send retries on the probabilistic mixnet, and
 * failures (e.g. a cosigner who's offline) can be re-sent without redoing the
 * rest.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Loader2, Check, X, Circle, Wifi, UserPlus } from 'lucide-react';
import { AddressIcon, AddressLabel } from '@/components/ui';
import { useAccountsStore } from '@/store';
import type { Multisig } from '@/store';
import { useCmixOnlineStore } from '@/store/cmixOnline';
import { useCmixContactsStore } from '@/store/cmixContacts';
import { deserializeRegistry } from '@/cmix/registrySerde';
import { contactsForAccount as registryContactsForAccount } from '@/cmix/contactRegistry';
import { getIDFromContact } from '@/cmix/e2eApi';
import { sendProposalToCosigners } from '@/cmix/messaging';
import type { BytesPackage } from '@/utils/bytesPackage';

type RowState = { state: 'pending' | 'delivered' | 'failed'; reason?: string };

interface CosignerRow {
  address: string;
  label?: string;
  contacts: Uint8Array[];
}

export function CmixSend({
  multisig,
  bytesPackage,
  isTwoDevice = false,
}: {
  multisig: Multisig;
  bytesPackage: BytesPackage | null;
  /** Reframes the copy for a two-device protected account (recipient is "your
   *  second device" rather than "cosigners"). */
  isTwoDevice?: boolean;
}) {
  const status = useCmixOnlineStore((s) => s.status);
  const handle = useCmixOnlineStore((s) => s.handle);
  const { accounts } = useAccountsStore();
  const bindings = useCmixContactsStore((s) => s.bindings);

  const mine = useMemo(() => new Set(accounts.map((a) => a.address)), [accounts]);

  // Cosigners (signers that aren't me) with at least one registered device-contact.
  // Derived straight from `bindings` so it recomputes when the registry changes.
  const cosigners = useMemo<CosignerRow[]>(() => {
    const registry = deserializeRegistry(bindings);
    return multisig.signers
      .filter((s) => !mine.has(s.address))
      .map((s) => ({
        address: s.address,
        label: s.label,
        contacts: registryContactsForAccount(registry, s.address),
      }))
      .filter((c) => c.contacts.length > 0);
  }, [multisig.signers, mine, bindings]);

  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);

  const online = status === 'online';
  const detailLink = `/multisig/${multisig.address}`;

  // ── Compact hints when the cMix path isn't usable yet ──────────────────────
  if (!online) {
    return (
      <Hint icon={<Radio size={14} strokeWidth={2} />}>
        Want to skip the {isTwoDevice ? 'QR' : 'file'}? Bring messaging online from{' '}
        <Link to={detailLink} className="text-xx-500 underline-offset-2 hover:underline">
          Cosigner messaging
        </Link>{' '}
        and send this {isTwoDevice ? 'straight to your second device' : 'straight'} over cMix.
      </Hint>
    );
  }
  if (cosigners.length === 0) {
    return (
      <Hint icon={<UserPlus size={14} strokeWidth={2} />}>
        To send this over cMix, add{' '}
        {isTwoDevice ? "your second device's contact" : "your cosigners' contacts"} in{' '}
        <Link to={detailLink} className="text-xx-500 underline-offset-2 hover:underline">
          Cosigner messaging
        </Link>{' '}
        first.
      </Hint>
    );
  }

  const notDelivered = cosigners.filter((c) => rowState[c.address]?.state !== 'delivered');
  const anyResult = cosigners.some((c) => rowState[c.address]);
  const allDelivered = notDelivered.length === 0;
  const canSend = !!handle && !!bytesPackage && !busy && !allDelivered;

  const send = async (rows: CosignerRow[]) => {
    if (!handle || !bytesPackage || rows.length === 0) return;
    setBusy(true);
    setRowState((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.address] = { state: 'pending' };
      return next;
    });
    await Promise.all(
      rows.map(async (row) => {
        try {
          const targets = row.contacts.map((contact) => ({
            contact,
            id: getIDFromContact(contact),
          }));
          const results = await sendProposalToCosigners(handle, targets, bytesPackage);
          // A cosigner is reached if ANY of their devices got it.
          const delivered = results.some((r) => r.delivered);
          const reason = delivered
            ? undefined
            : (results.find((r) => r.error)?.error ?? 'Not delivered.');
          setRowState((prev) => ({
            ...prev,
            [row.address]: { state: delivered ? 'delivered' : 'failed', reason },
          }));
        } catch (e) {
          setRowState((prev) => ({
            ...prev,
            [row.address]: {
              state: 'failed',
              reason: e instanceof Error ? e.message : String(e),
            },
          }));
        }
      })
    );
    setBusy(false);
  };

  const buttonLabel = busy
    ? 'Sending…'
    : allDelivered
      ? 'All sent'
      : anyResult
        ? `Resend (${notDelivered.length})`
        : isTwoDevice
          ? 'Send to your second device'
          : `Send to ${cosigners.length} cosigner${cosigners.length !== 1 ? 's' : ''}`;

  return (
    <div className="card space-y-3 border border-xx-500/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-xx-500 flex-shrink-0" strokeWidth={2.25} />
          <p className="text-xs uppercase tracking-wider text-xx-500 font-medium">
            Send over cMix
          </p>
        </div>
      </div>
      <p className="text-xs text-ink-300 leading-relaxed">
        Deliver this{' '}
        {isTwoDevice ? 'to your second device' : 'proposal to your cosigners'} privately over
        the mixnet — no {isTwoDevice ? 'QR to scan' : 'file to pass around'}.{' '}
        {isTwoDevice ? 'It gets' : 'They get'} the same hash-verified call data.
      </p>

      <div className="space-y-2">
        {cosigners.map((c) => (
          <div key={c.address} className="flex items-center gap-3">
            <AddressIcon address={c.address} size={24} />
            <div className="flex-1 min-w-0">
              {c.label ? (
                <p className="text-sm text-ink-100 truncate">{c.label}</p>
              ) : (
                <AddressLabel address={c.address} className="text-sm" />
              )}
              {rowState[c.address]?.state === 'failed' && rowState[c.address]?.reason && (
                <p className="text-xs text-danger leading-snug break-words">
                  {rowState[c.address]?.reason}
                </p>
              )}
            </div>
            <DeliveryBadge state={rowState[c.address]} />
          </div>
        ))}
      </div>

      <button
        onClick={() => send(notDelivered)}
        disabled={!canSend}
        className="btn-secondary w-full"
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin" strokeWidth={2} />
        ) : (
          <Radio size={15} strokeWidth={2} />
        )}
        {buttonLabel}
      </button>
    </div>
  );
}

function DeliveryBadge({ state }: { state?: RowState }) {
  if (!state) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-300 flex-shrink-0">
        <Circle size={9} strokeWidth={2} /> Not sent
      </span>
    );
  }
  if (state.state === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-300 flex-shrink-0">
        <Loader2 size={12} className="animate-spin" strokeWidth={2} /> Sending…
      </span>
    );
  }
  if (state.state === 'delivered') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-xx-500 flex-shrink-0">
        <Check size={12} strokeWidth={2.5} /> Sent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-danger flex-shrink-0">
      <X size={12} strokeWidth={2.5} /> Failed
    </span>
  );
}

function Hint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-1 text-xs text-ink-300 leading-relaxed">
      <span className="text-ink-300 flex-shrink-0 mt-0.5">{icon}</span>
      <p>{children}</p>
    </div>
  );
}
