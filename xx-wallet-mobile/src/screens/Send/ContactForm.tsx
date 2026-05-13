/**
 * ContactForm — the Add / Edit / Details Sheet for an address-book contact.
 *
 * Modes:
 * - 'add': blank form, address input, debounced on-chain identity preview.
 * - 'edit': pre-filled, address read-only, cached identity banner shown.
 * - 'details': read-only view, live balance, Send-to and Edit shortcuts.
 *
 * Owns the inline `IdentityPreviewCard` and `IdentityField` subcomponents
 * (only used here). Also exports the small `isVerifiedJudgement` and
 * `judgementLabel` helpers used by the surrounding Send screen tree.
 */

import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Check,
  Trash2,
  BadgeCheck,
  Mail,
  Twitter,
  Globe,
  MessageCircle,
  Loader2,
  Edit2,
  ArrowUpRight,
} from 'lucide-react';
import { useAddressBook } from '@/store';
import type { Contact, OnChainIdentity } from '@/store';
import { useBalance } from '@/hooks';
import { isValidXxAddress, formatBalance, shortenAddress } from '@/utils';
import { fetchIdentity } from '@/api';
import { Sheet } from '@/components/ui';
import clsx from 'clsx';

export type ContactFormMode = 'add' | 'edit' | 'details' | null;

interface ContactFormProps {
  mode: ContactFormMode;
  /** The contact being viewed/edited. Null in 'add' mode or when mode is null. */
  contact: Contact | null;
  /** Address to prefill in 'add' mode (e.g. from "Save as contact" shortcut). */
  prefillAddress?: string;
  /** Sheet dismissed (back, swipe, cancel) — parent should reopen contacts. */
  onClose: () => void;
  /** Save succeeded. Parent decides whether to set the recipient (only useful
   *  from add mode when current recipient is empty), then closes the form. */
  onSaved: (savedAddress: string, fromAddMode: boolean) => void;
  /** Details-mode "Send to" — set recipient and close everything (no reopen). */
  onSendTo: (address: string) => void;
  /** Details-mode "Edit" — switch to edit mode for the same contact. */
  onSwitchToEdit: (contactId: string) => void;
  /** Open the delete confirmation Sheet (rendered by parent). */
  onRequestDelete: (contactId: string) => void;
}

export function ContactForm({
  mode,
  contact,
  prefillAddress,
  onClose,
  onSaved,
  onSendTo,
  onSwitchToEdit,
  onRequestDelete,
}: ContactFormProps) {
  const { addContact, updateContact, setIdentity, contacts } = useAddressBook();

  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Debounced on-chain identity preview (add mode mostly)
  const [previewIdentity, setPreviewIdentity] = useState<OnChainIdentity | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Live balance for details/edit mode
  const { balance: contactBalance, isLoading: contactBalanceLoading } = useBalance(
    (mode === 'details' || mode === 'edit') ? (contact?.address ?? null) : null
  );

  // Reset / repopulate form fields when mode or contact changes
  useEffect(() => {
    setFormError(null);
    setPreviewIdentity(null);
    setPreviewLoading(false);

    if (mode === null) {
      setFormName('');
      setFormAddress('');
      setFormNote('');
      return;
    }
    if (mode === 'add') {
      setFormName('');
      setFormAddress(prefillAddress ?? '');
      setFormNote('');
      return;
    }
    if (contact) {
      setFormName(contact.name);
      setFormAddress(contact.address);
      setFormNote(contact.note ?? '');
    }
    // We intentionally only re-key on mode + contact id + prefill, not on full
    // contact object reference, so the user's typing in edit mode isn't wiped
    // by an unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, contact?.id, prefillAddress]);

  // Debounced identity preview as user types address (add or edit)
  useEffect(() => {
    if (mode !== 'add' && mode !== 'edit') {
      setPreviewIdentity(null);
      setPreviewLoading(false);
      return;
    }
    const addr = formAddress.trim();
    if (!isValidXxAddress(addr)) {
      setPreviewIdentity(null);
      setPreviewLoading(false);
      return;
    }
    // If editing and address matches the original, use the cached identity
    if (mode === 'edit' && contact && contact.address === addr && contact.identity !== undefined) {
      setPreviewIdentity(contact.identity);
      return;
    }

    setPreviewLoading(true);
    const cancelToken = { cancelled: false };
    const timer = setTimeout(async () => {
      try {
        const identity = await fetchIdentity(addr);
        if (!cancelToken.cancelled) {
          setPreviewIdentity(identity);
        }
      } finally {
        if (!cancelToken.cancelled) setPreviewLoading(false);
      }
    }, 600); // debounce so we don't hammer the indexer on each keystroke

    return () => {
      cancelToken.cancelled = true;
      clearTimeout(timer);
    };
  }, [formAddress, mode, contact]);

  const handleSave = async () => {
    setFormError(null);
    const addr = formAddress.trim();
    if (!isValidXxAddress(addr)) {
      setFormError('Not a valid xx network address. Addresses start with "6".');
      return;
    }
    // Check for duplicates (excluding the contact being edited)
    const duplicate = contacts.find(
      (c) => c.address === addr && c.id !== contact?.id
    );
    if (duplicate) {
      const label = duplicate.name || duplicate.identity?.display || shortenAddress(duplicate.address);
      setFormError(`This address is already saved as "${label}".`);
      return;
    }

    const name = formName.trim();
    const note = formNote.trim() || undefined;

    let savedId: string | null = null;
    if (mode === 'edit' && contact) {
      updateContact(contact.id, { name, address: addr, note });
      savedId = contact.id;
    } else {
      const newContact = addContact(addr, name, note);
      savedId = newContact.id;
    }

    const fromAddMode = mode === 'add';
    onSaved(addr, fromAddMode);

    // After-save identity fetch.
    // - If we already have a previewIdentity, write it to the saved contact.
    // - Otherwise (just-added without preview having loaded), fetch in the
    //   background. This is the one automatic identity fetch — on add only,
    //   because the user clearly signaled they want this contact. Subsequent
    //   refreshes only happen via the explicit "Sync identities" button.
    if (savedId && !previewIdentity) {
      try {
        const identity = await fetchIdentity(addr);
        setIdentity(savedId, identity);
      } catch {
        /* silent — user can manually sync later */
      }
    } else if (savedId && previewIdentity) {
      setIdentity(savedId, previewIdentity);
    }
  };

  return (
    <Sheet
      open={mode !== null}
      onClose={onClose}
      title={
        mode === 'details'
          ? 'Contact Details'
          : mode === 'edit'
          ? 'Edit Contact Details'
          : 'Add contact'
      }
    >
      <div className="space-y-4">

        {/* ── DETAILS MODE: account info panel ── */}
        {mode === 'details' && contact && (
          <>
            {/* Identity banner */}
            {contact.identity && (
              <div className="p-3 rounded-xl bg-xx-500/5 border border-xx-500/20 space-y-1">
                <div className="flex items-center gap-2">
                  <BadgeCheck
                    size={15}
                    className={isVerifiedJudgement(contact.identity.judgement)
                      ? 'text-xx-500' : 'text-ink-400'}
                    strokeWidth={2}
                  />
                  <p className="text-xs font-medium text-ink-100">
                    {contact.identity.display ?? 'On-chain identity'}
                    {isVerifiedJudgement(contact.identity.judgement) && (
                      <span className="ml-1.5 text-xx-500">· Verified</span>
                    )}
                  </p>
                </div>
                {contact.identity.legal && (
                  <p className="text-xs text-ink-400 pl-5">Legal: {contact.identity.legal}</p>
                )}
                {contact.identity.email && (
                  <p className="text-xs text-ink-400 pl-5 flex items-center gap-1">
                    <Mail size={11} />{contact.identity.email}
                  </p>
                )}
                {contact.identity.twitter && (
                  <p className="text-xs text-ink-400 pl-5 flex items-center gap-1">
                    <Twitter size={11} />{contact.identity.twitter}
                  </p>
                )}
                {contact.identity.web && (
                  <p className="text-xs text-ink-400 pl-5 flex items-center gap-1">
                    <Globe size={11} />{contact.identity.web}
                  </p>
                )}
                {contact.identity.riot && (
                  <p className="text-xs text-ink-400 pl-5 flex items-center gap-1">
                    <MessageCircle size={11} />{contact.identity.riot}
                  </p>
                )}
              </div>
            )}

            {/* Balance */}
            <div className="p-3 rounded-xl bg-ink-800 border border-ink-700/50 space-y-2">
              <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">Balance</p>
              {contactBalanceLoading ? (
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <Loader2 size={12} className="animate-spin" />
                  Fetching balance…
                </div>
              ) : contactBalance ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <p className="text-xs text-ink-400">Transferable</p>
                    <p className="text-sm font-medium font-mono text-ink-100">
                      {formatBalance(contactBalance.transferable, { decimals: 4 })} XX
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-400">Total</p>
                    <p className="text-sm font-medium font-mono text-ink-100">
                      {formatBalance(contactBalance.total, { decimals: 4 })} XX
                    </p>
                  </div>
                  {contactBalance.reserved.gtn(0) && (
                    <div>
                      <p className="text-xs text-ink-400">Reserved</p>
                      <p className="text-xs font-mono text-ink-300">
                        {formatBalance(contactBalance.reserved, { decimals: 4 })} XX
                      </p>
                    </div>
                  )}
                  {contactBalance.frozen.gtn(0) && (
                    <div>
                      <p className="text-xs text-ink-400">Frozen</p>
                      <p className="text-xs font-mono text-ink-300">
                        {formatBalance(contactBalance.frozen, { decimals: 4 })} XX
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink-400">No balance found — account may be new.</p>
              )}
            </div>

            {/* Action buttons for details mode */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onSendTo(contact.address)}
                className="btn-primary"
              >
                <ArrowUpRight size={16} />
                Send to
              </button>
              <button
                onClick={() => onSwitchToEdit(contact.id)}
                className="btn-secondary"
              >
                <Edit2 size={16} />
                Edit
              </button>
            </div>

            <div className="border-t border-ink-700/50 pt-3">
              <p className="text-xs uppercase tracking-wide text-ink-400 font-medium mb-2">
                Saved info
              </p>
              <div className="space-y-1">
                <p className="text-xs text-ink-300">
                  <span className="text-ink-400">Name: </span>
                  {contact.name || <span className="italic text-ink-600">not set</span>}
                </p>
                <p className="text-xs font-mono text-ink-400 break-all">
                  {contact.address}
                </p>
                {contact.note && (
                  <p className="text-xs text-ink-400">
                    <span className="text-ink-400">Note: </span>{contact.note}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── ADD / EDIT MODE: editable fields ── */}
        {(mode === 'add' || mode === 'edit') && (
          <>
            {/* Address first — it's the only required field */}
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Address <span className="text-danger normal-case font-normal">*</span>
              </label>
              <textarea
                value={formAddress}
                onChange={(e) => { setFormAddress(e.target.value); setFormError(null); }}
                className="input-base min-h-[80px] py-3 font-mono text-sm resize-none"
                placeholder="6…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={mode === 'add'}
                readOnly={mode === 'edit'}
              />
              {formAddress && isValidXxAddress(formAddress.trim()) && (
                <p className="text-xs text-xx-500 mt-1 flex items-center gap-1">
                  <Check size={12} />Valid xx address
                </p>
              )}
            </div>

            {/* On-chain identity preview — only in add mode */}
            {mode === 'add' && formAddress && isValidXxAddress(formAddress.trim()) && (
              <IdentityPreviewCard
                identity={previewIdentity}
                loading={previewLoading}
                onUseDisplayName={(display) => setFormName(display)}
                currentName={formName}
              />
            )}

            {/* Cached identity in edit mode */}
            {mode === 'edit' && contact?.identity && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-xx-500/5 border border-xx-500/20">
                <BadgeCheck size={13} className={isVerifiedJudgement(contact.identity.judgement) ? 'text-xx-500' : 'text-ink-400'} />
                <p className="text-xs text-ink-300">
                  On-chain: {contact.identity.display ?? 'identity set'}
                  {isVerifiedJudgement(contact.identity.judgement) && (
                    <span className="text-xx-500"> · Verified</span>
                  )}
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Name <span className="text-ink-400 normal-case font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setFormError(null); }}
                className="input-base"
                placeholder={
                  previewIdentity?.display
                    ? `Leave blank to use "${previewIdentity.display}"`
                    : contact?.identity?.display
                    ? `Leave blank to use "${contact.identity.display}"`
                    : 'e.g. Exchange, Cold storage, Friend'
                }
                maxLength={50}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Note <span className="text-ink-400 normal-case font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                className="input-base"
                placeholder="e.g. My Kraken deposit address"
                maxLength={100}
              />
            </div>
            {formError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm">
                <AlertTriangle size={14} className="text-danger flex-shrink-0 mt-0.5" />
                <span className="text-ink-200">{formError}</span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              {mode === 'edit' && contact && (
                <button
                  onClick={() => onRequestDelete(contact.id)}
                  className="btn-secondary flex-shrink-0 px-4 text-danger"
                  aria-label="Delete contact"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!formAddress.trim()}
                className="btn-primary flex-1"
              >
                {mode === 'edit' ? 'Save changes' : 'Save contact'}
              </button>
            </div>
          </>
        )}

      </div>
    </Sheet>
  );
}

/**
 * Returns true if the given judgement string represents a verified identity.
 * The xx network uses the standard Substrate identity judgement kinds.
 */
export function isVerifiedJudgement(judgement: string | undefined): boolean {
  if (!judgement) return false;
  const j = judgement.toLowerCase();
  return j === 'reasonable' || j === 'knowngood';
}

/** Human-readable label for a judgement kind */
export function judgementLabel(judgement: string | undefined): string | null {
  if (!judgement) return null;
  switch (judgement.toLowerCase()) {
    case 'knowngood': return 'Verified';
    case 'reasonable': return 'Verified';
    case 'outofdate': return 'Out of date';
    case 'lowquality': return 'Low quality';
    case 'erroneous': return 'Disputed';
    case 'feepaid': return 'Pending review';
    default: return null;
  }
}

/**
 * Shows a preview of the on-chain identity for the address being entered.
 * Lets the user one-tap apply the on-chain display name as the contact name.
 */
function IdentityPreviewCard({
  identity,
  loading,
  onUseDisplayName,
  currentName,
}: {
  identity: OnChainIdentity | null;
  loading: boolean;
  onUseDisplayName: (display: string) => void;
  currentName: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-ink-800/50 border border-ink-700/50 text-xs text-ink-400">
        <Loader2 size={14} className="animate-spin flex-shrink-0" />
        Looking up on-chain identity…
      </div>
    );
  }

  if (!identity) {
    return null;
  }

  const verified = isVerifiedJudgement(identity.judgement);
  const jLabel = judgementLabel(identity.judgement);

  return (
    <div className="p-3 rounded-xl bg-xx-500/5 border border-xx-500/30 space-y-2">
      <div className="flex items-start gap-2">
        <BadgeCheck
          size={16}
          className={clsx('flex-shrink-0 mt-0.5', verified ? 'text-xx-500' : 'text-ink-400')}
          strokeWidth={2}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-ink-100">
            On-chain identity {verified && <span className="text-xx-500">verified</span>}
          </p>
          {jLabel && !verified && (
            <p className="text-xs text-ink-400">Status: {jLabel}</p>
          )}
        </div>
      </div>

      {identity.display && (
        <div className="flex items-center justify-between gap-2 pl-6">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-ink-400">Display name</p>
            <p className="text-sm font-medium text-ink-100 truncate">{identity.display}</p>
          </div>
          {currentName.trim() !== identity.display && (
            <button
              onClick={() => onUseDisplayName(identity.display!)}
              className="flex-shrink-0 text-xs font-medium text-xx-500 active:text-xx-600 px-2 py-1 rounded-lg bg-xx-500/10"
            >
              Use
            </button>
          )}
        </div>
      )}

      {identity.legal && (
        <IdentityField icon={null} label="Legal name" value={identity.legal} />
      )}
      {identity.email && (
        <IdentityField icon={<Mail size={11} />} label="Email" value={identity.email} />
      )}
      {identity.twitter && (
        <IdentityField icon={<Twitter size={11} />} label="Twitter" value={identity.twitter} />
      )}
      {identity.web && (
        <IdentityField icon={<Globe size={11} />} label="Website" value={identity.web} />
      )}
      {identity.riot && (
        <IdentityField icon={<MessageCircle size={11} />} label="Matrix/Riot" value={identity.riot} />
      )}
    </div>
  );
}

function IdentityField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 pl-6">
      {icon && <span className="text-ink-400 flex-shrink-0">{icon}</span>}
      <span className="text-xs uppercase tracking-wide text-ink-400 flex-shrink-0">
        {label}:
      </span>
      <span className="text-xs text-ink-200 truncate min-w-0">{value}</span>
    </div>
  );
}
