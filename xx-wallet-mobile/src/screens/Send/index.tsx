import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BigNumber from 'bignumber.js';
import {
  AlertTriangle,
  Check,
  Loader2,
  ArrowUpRight,
  ScanLine,
  BookUser,
  ShieldAlert,
  UserPlus,
  BadgeCheck,
} from 'lucide-react';
import { useAccountsStore, useAddressBook } from '@/store';
import { useBalance, useTx } from '@/hooks';
import { isValidXxAddress, formatBalance, parseAmount, shortenAddress } from '@/utils';
import { XX_SYMBOL, XX_DECIMALS } from '@/api';
import { TopBar } from '@/components/layout';
import { Sheet, AddressChip, QrScanner, AddressIcon } from '@/components/ui';
import { ContactsSheet } from './ContactsSheet';
import { ContactForm, isVerifiedJudgement, type ContactFormMode } from './ContactForm';

/**
 * Existential deposit for the xx network — 1,000,000 planck = 0.001 XX.
 * If an account's balance drops below this, it is removed from chain state.
 * Source: confirmed from xx network chain configuration.
 */
const EXISTENTIAL_DEPOSIT = new BigNumber('1000000'); // 0.001 XX in planck

/**
 * Send screen.
 *
 * Uses `balances.transferKeepAlive` by default — this prevents the sender's
 * account from being reaped (removed from state) if their balance would drop
 * below the existential deposit. The transaction will be rejected by the chain
 * rather than silently destroying the account.
 *
 * We also warn when the recipient is likely a new account receiving less than
 * the existential deposit, since they would never appear on-chain.
 *
 * Address-book management lives in sibling files: ContactsSheet (the picker),
 * ContactForm (add/edit/details), contactImportExport (file IO). This screen
 * owns the top-level state coordinating them and the delete-confirmation Sheet.
 */
export function Send() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { accounts, activeAddress } = useAccountsStore();
  const { contacts, removeContact } = useAddressBook();
  const active = accounts.find((a) => a.address === activeAddress) ?? accounts[0];
  const { balance } = useBalance(active?.address ?? null);
  const { submit, status, txHash, error: txError, reset } = useTx();

  // Send form state
  const [recipient, setRecipient] = useState(() => searchParams.get('to') ?? '');
  const [amount, setAmount] = useState('');

  // Confirmation state
  const [password, setPassword] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // QR scanner state
  const [scannerOpen, setScannerOpen] = useState(false);

  // Contacts coordination state (shared across ContactsSheet, ContactForm, and
  // the local Delete-confirmation Sheet)
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactFormMode, setContactFormMode] = useState<ContactFormMode>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactFormPrefill, setContactFormPrefill] = useState<string | undefined>(undefined);
  const [toDeleteContactId, setToDeleteContactId] = useState<string | null>(null);

  // Look up if the current recipient matches a saved contact
  const matchedContact = useMemo(
    () => contacts.find((c) => c.address === recipient.trim()),
    [contacts, recipient]
  );
  const editingContact = contacts.find((c) => c.id === editingContactId) ?? null;

  const recipientValid = isValidXxAddress(recipient.trim());

  // Self-send guard. On Substrate, transferKeepAlive(A → A) is a chain-level
  // no-op that costs a fee but emits no Transfer event, so the dashboard's
  // indexer-backed activity list never shows it — the user sees a "finalized"
  // success message and then nothing in their history, which is confusing.
  // Block it in the UI rather than try to explain the chain semantics.
  const recipientIsSelf =
    !!active &&
    recipient.trim().length > 0 &&
    recipient.trim() === active.address;
  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);

  const transferable = balance
    ? new BigNumber(balance.transferable.toString())
    : null;

  // Would sender drop below existential deposit after this send?
  const senderBelowED = useMemo(() => {
    if (!parsedAmount || !transferable) return false;
    const remaining = transferable.minus(parsedAmount);
    return remaining.isGreaterThan(0) && remaining.isLessThan(EXISTENTIAL_DEPOSIT);
  }, [parsedAmount, transferable]);

  // Is recipient amount below existential deposit (new account risk)?
  const recipientBelowED = useMemo(() => {
    if (!parsedAmount) return false;
    return parsedAmount.isLessThan(EXISTENTIAL_DEPOSIT);
  }, [parsedAmount]);

  const amountValid =
    parsedAmount !== null &&
    parsedAmount.isGreaterThan(0) &&
    transferable !== null &&
    parsedAmount.isLessThanOrEqualTo(transferable);

  const canContinue = recipientValid && !recipientIsSelf && amountValid && active;

  // Show "Save as contact" when recipient is valid but not yet saved.
  // Excluding self-sends here because saving "yourself" as a contact is
  // never useful and would be a confusing offer next to the self-send error.
  const canSaveCurrentRecipient =
    recipientValid &&
    !recipientIsSelf &&
    !matchedContact &&
    recipient.trim().length > 0;

  // Safe max — leaves enough to stay above existential deposit
  const setMax = () => {
    if (!transferable) return;
    // transferKeepAlive will reject below ED anyway, but we subtract here for
    // a clean UX — no failed-tx surprises.
    const safeMax = transferable.minus(EXISTENTIAL_DEPOSIT);
    if (safeMax.isLessThanOrEqualTo(0)) return;
    const human = safeMax
      .div(new BigNumber(10).pow(XX_DECIMALS))
      .toFixed(XX_DECIMALS)
      .replace(/\.?0+$/, '');
    setAmount(human);
  };

  const handleScan = (result: string) => {
    setRecipient(result);
    setScannerOpen(false);
  };

  const handleConfirm = async () => {
    if (!active || !parsedAmount) return;
    setPasswordError(null);
    try {
      await submit(
        (api) =>
          api.tx.balances.transferKeepAlive(
            recipient.trim(),
            parsedAmount.toFixed(0)
          ),
        { address: active.address, password }
      );
    } catch (err) {
      const msg = (err as Error).message;
      // Surface password errors directly under the password field
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('unable to decode') ||
        msg.toLowerCase().includes('incorrect')
      ) {
        setPasswordError('Incorrect password. Please try again.');
      }
      // Other errors are shown in the main error block via txError
    }
  };

  const isSubmitting =
    status === 'signing' || status === 'broadcasting' || status === 'in-block';
  const isDone = status === 'finalized';

  // Human-readable status label
  const submitLabel = {
    idle: 'Confirm and send',
    error: 'Confirm and send',
    signing: 'Signing…',
    broadcasting: 'Sending to network…',
    'in-block': 'Waiting for finality…',
    finalized: 'Done',
  }[status];

  // ── Contacts coordination handlers ──────────────────────────────────────

  const handleSelectContact = (address: string) => {
    setRecipient(address);
    setContactsOpen(false);
  };

  const handleOpenAdd = (prefill?: string) => {
    setContactFormPrefill(prefill);
    setContactFormMode('add');
    setEditingContactId(null);
    setContactsOpen(false);
  };

  const handleOpenDetails = (id: string) => {
    setContactFormPrefill(undefined);
    setContactFormMode('details');
    setEditingContactId(id);
    setContactsOpen(false);
  };

  const handleSwitchToEdit = (id: string) => {
    setContactFormPrefill(undefined);
    setContactFormMode('edit');
    setEditingContactId(id);
  };

  const handleContactFormClose = () => {
    setContactFormMode(null);
    setEditingContactId(null);
    setContactFormPrefill(undefined);
    setContactsOpen(true);
  };

  const handleContactSaved = (savedAddress: string, fromAddMode: boolean) => {
    // Pre-fill recipient if we just added from the "Save as contact" shortcut
    // and the recipient field was empty.
    if (fromAddMode && !recipient.trim()) {
      setRecipient(savedAddress);
    }
    setContactFormMode(null);
    setEditingContactId(null);
    setContactFormPrefill(undefined);
    setContactsOpen(true);
  };

  const handleContactSendTo = (address: string) => {
    setRecipient(address);
    setContactFormMode(null);
    setEditingContactId(null);
    setContactsOpen(false);
  };

  const handleRequestDelete = (id: string) => {
    setToDeleteContactId(id);
  };

  const handleDeleteConfirmed = () => {
    if (!toDeleteContactId) return;
    const wasEditingThisContact = editingContactId === toDeleteContactId;
    removeContact(toDeleteContactId);
    setToDeleteContactId(null);
    // If the contact form was open for this contact, close it and reopen contacts.
    if (wasEditingThisContact) {
      setContactFormMode(null);
      setEditingContactId(null);
      setContactsOpen(true);
    }
  };

  return (
    <>
      <TopBar title="Send" showBack />

      {/* QR Scanner — full screen takeover */}
      {scannerOpen && (
        <QrScanner
          onScan={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}

      <div className="px-5 py-4 space-y-5 max-w-md mx-auto">
        {/* Recipient */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-ink-300 uppercase tracking-wide">
              Recipient address
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setContactsOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-ink-300 active:text-ink-100"
              >
                <BookUser size={14} />
                {contacts.length > 0 ? `Contacts (${contacts.length})` : 'Contacts'}
              </button>
              <button
                onClick={() => setScannerOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-xx-500 active:text-xx-600"
              >
                <ScanLine size={14} />
                Scan QR
              </button>
            </div>
          </div>
          <textarea
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="input-base min-h-[88px] py-3 font-mono text-sm resize-none"
            placeholder="6… or scan a QR code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {recipient && !recipientValid && (
            <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
              <AlertTriangle size={12} />
              Not a valid xx network address — addresses start with "6"
            </p>
          )}
          {recipientValid && recipientIsSelf && (
            <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
              <AlertTriangle size={12} />
              That's your own active account. Pick a different recipient.
            </p>
          )}
          {recipientValid && !recipientIsSelf && !matchedContact && (
            <div className="flex items-center justify-between mt-1.5 gap-2">
              <p className="text-xs text-xx-500 flex items-center gap-1">
                <Check size={12} />
                Valid xx address
              </p>
              {canSaveCurrentRecipient && (
                <button
                  onClick={() => handleOpenAdd(recipient.trim())}
                  className="text-xs font-medium text-ink-300 active:text-ink-100 flex items-center gap-1"
                >
                  <UserPlus size={12} />
                  Save as contact
                </button>
              )}
            </div>
          )}
          {recipientValid && !recipientIsSelf && matchedContact && (
            <div className="flex items-center gap-2 mt-1.5 p-2 rounded-xl bg-xx-500/5 border border-xx-500/30">
              <AddressIcon address={matchedContact.address} size={22} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <p className="text-xs font-medium text-ink-100 truncate">
                    Sending to{' '}
                    <span className="text-xx-500">
                      {matchedContact.name || matchedContact.identity?.display || shortenAddress(matchedContact.address)}
                    </span>
                  </p>
                  {isVerifiedJudgement(matchedContact.identity?.judgement) && (
                    <BadgeCheck size={12} className="text-xx-500 flex-shrink-0" strokeWidth={2.25} />
                  )}
                </div>
                {matchedContact.name && matchedContact.identity?.display && matchedContact.identity.display !== matchedContact.name && (
                  <p className="text-[10px] text-ink-400 truncate">
                    on-chain: {matchedContact.identity.display}
                  </p>
                )}
                {matchedContact.note && (
                  <p className="text-[10px] text-ink-500 truncate">{matchedContact.note}</p>
                )}
              </div>
              <button
                onClick={() => handleOpenDetails(matchedContact.id)}
                className="text-[10px] font-medium text-ink-400 active:text-ink-200 px-2 py-1"
              >
                Details
              </button>
            </div>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className="flex justify-between items-baseline mb-1.5">
            <label className="text-xs font-medium text-ink-300 uppercase tracking-wide">
              Amount
            </label>
            {balance && (
              <button
                onClick={setMax}
                className="text-xs font-medium text-xx-500 active:text-xx-600"
              >
                Max: {formatBalance(balance.transferable, { decimals: 4 })}
              </button>
            )}
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                const cleaned =
                  parts.length > 2
                    ? `${parts[0]}.${parts.slice(1).join('')}`
                    : v;
                setAmount(cleaned);
              }}
              className="input-base pr-16 text-xl font-mono"
              placeholder="0.0"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-300 font-display font-medium">
              {XX_SYMBOL}
            </span>
          </div>
          {amount && parsedAmount === null && (
            <p className="text-xs text-danger mt-1.5">
              Invalid amount — enter a number like 1.5
            </p>
          )}
          {amount &&
            parsedAmount !== null &&
            transferable &&
            parsedAmount.isGreaterThan(transferable) && (
              <p className="text-xs text-danger mt-1.5">
                Amount exceeds your transferable balance
              </p>
            )}
          {/* Existential deposit warnings */}
          {senderBelowED && (
            <div className="flex items-start gap-2 mt-2 p-3 rounded-xl bg-warning/10 border border-warning/30">
              <ShieldAlert size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-200 leading-relaxed">
                This would leave your account below the minimum balance (0.001 XX).
                Your account could be removed from the network.{' '}
                <span className="text-warning font-medium">transferKeepAlive</span> will
                prevent this transaction from going through — reduce the amount slightly.
              </p>
            </div>
          )}
          {recipientBelowED && recipientValid && !senderBelowED && (
            <div className="flex items-start gap-2 mt-2 p-3 rounded-xl bg-warning/10 border border-warning/30">
              <ShieldAlert size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-200 leading-relaxed">
                Sending less than 0.001 XX to a new account may mean it never
                appears on the blockchain. Make sure the recipient already has
                an existing balance.
              </p>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!canContinue}
          className="btn-primary w-full"
        >
          <ArrowUpRight size={18} />
          Review transaction
        </button>
      </div>

      {/* Confirmation sheet */}
      <Sheet
        open={confirmOpen && !isDone}
        onClose={() => {
          if (!isSubmitting) {
            setConfirmOpen(false);
            setPassword('');
            reset();
          }
        }}
        title="Confirm send"
      >
        <div className="space-y-4">
          <div className="space-y-3 p-4 rounded-2xl bg-ink-800 border border-ink-700/50">
            <Row label="To">
              <AddressChip address={recipient.trim()} />
            </Row>
            <Row label="Amount">
              <span className="font-mono text-base text-ink-100">
                {amount} {XX_SYMBOL}
              </span>
            </Row>
            <Row label="From">
              <span className="font-medium text-sm">{active?.name}</span>
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

          {/* Generic tx error (not password-related) */}
          {txError && !passwordError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
              <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-0.5">Transaction failed</p>
                <p className="text-xs text-ink-300 break-all">{txError.message}</p>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !password}
            className="btn-primary w-full"
          >
            {isSubmitting && <Loader2 size={18} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </Sheet>

      {/* Success sheet */}
      <Sheet
        open={isDone}
        onClose={() => {
          reset();
          setConfirmOpen(false);
          navigate('/', { replace: true });
        }}
      >
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-xx-500/10 border border-xx-500/40 flex items-center justify-center">
            <Check size={32} className="text-xx-500" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-xl">Transaction sent</h2>
            <p className="text-sm text-ink-400 mt-1">
              Finalized on the xx network.
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
          <button
            onClick={() => {
              reset();
              setConfirmOpen(false);
              navigate('/', { replace: true });
            }}
            className="btn-primary w-full mt-2"
          >
            Done
          </button>
        </div>
      </Sheet>

      {/* Contacts picker / management */}
      <ContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        currentRecipient={recipient}
        onSelectContact={handleSelectContact}
        onOpenAdd={() => handleOpenAdd()}
        onOpenDetails={handleOpenDetails}
        onRequestDelete={handleRequestDelete}
      />

      {/* Add / Edit / Details contact form */}
      <ContactForm
        mode={contactFormMode}
        contact={editingContact}
        prefillAddress={contactFormPrefill}
        onClose={handleContactFormClose}
        onSaved={handleContactSaved}
        onSendTo={handleContactSendTo}
        onSwitchToEdit={handleSwitchToEdit}
        onRequestDelete={handleRequestDelete}
      />

      {/* Delete confirmation — shared by ContactsSheet and ContactForm */}
      <Sheet
        open={toDeleteContactId !== null}
        onClose={() => setToDeleteContactId(null)}
        title="Delete contact"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-danger/10 border border-danger/30">
            <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-ink-100 mb-1">Remove this contact?</p>
              <p className="text-xs text-ink-300 leading-relaxed">
                {contacts.find((c) => c.id === toDeleteContactId)?.name} will be removed from your
                address book. This doesn't affect any wallets or funds.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setToDeleteContactId(null)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirmed}
              className="btn-primary bg-danger text-white active:bg-danger/80"
            >
              Delete
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-400 uppercase tracking-wide flex-shrink-0">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
