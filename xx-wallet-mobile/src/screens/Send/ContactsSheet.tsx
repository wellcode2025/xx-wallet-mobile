/**
 * ContactsSheet — the address-book picker / management Sheet.
 *
 * Lets the user search contacts, pick one to use as the recipient, sync
 * on-chain identities (only on explicit press — never on background timers,
 * which is a battery + data decision for mobile), import/export contacts as
 * JSON, and trigger details/delete flows that the parent renders via separate
 * sheets.
 */

import { useState, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  Plus,
  Trash2,
  Edit2,
  Search,
  UserCircle2,
  Copy,
  RefreshCw,
  Upload,
  Download as DownloadIcon,
  BadgeCheck,
} from 'lucide-react';
import { useAddressBook } from '@/store';
import { shortenAddress } from '@/utils';
import { copyToClipboard } from '@/utils/clipboard';
import { fetchIdentitiesBatch } from '@/api';
import { Sheet, AddressIcon } from '@/components/ui';
import clsx from 'clsx';
import { isVerifiedJudgement } from './ContactForm';
import {
  downloadContactsAsJson,
  readContactsImportFile,
  type ContactImportResult,
} from './contactImportExport';

interface ContactsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Currently typed recipient address (used to highlight the matching row). */
  currentRecipient: string;
  /** Tap on a contact (whole row or "Use" button) — set as recipient and close. */
  onSelectContact: (address: string) => void;
  /** Tap "Add" — open the add-contact form (parent renders ContactForm). */
  onOpenAdd: () => void;
  /** Tap "Details" on a row — open the read-only details form. */
  onOpenDetails: (contactId: string) => void;
  /** Tap "Delete" on a row — open the delete confirmation Sheet. */
  onRequestDelete: (contactId: string) => void;
}

export function ContactsSheet({
  open,
  onClose,
  currentRecipient,
  onSelectContact,
  onOpenAdd,
  onOpenDetails,
  onRequestDelete,
}: ContactsSheetProps) {
  const { contacts, setIdentity, importContacts, exportContacts } = useAddressBook();

  const [contactSearch, setContactSearch] = useState('');
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  // "Sync identities" — explicit user action only, never on background timers.
  // Reason: battery + data cost on mobile.
  const handleSyncIdentities = async () => {
    if (contacts.length === 0) return;
    setSyncProgress({ done: 0, total: contacts.length });
    const addresses = contacts.map((c) => c.address);
    const results = await fetchIdentitiesBatch(addresses, (done, total) => {
      setSyncProgress({ done, total });
    });
    for (const c of contacts) {
      const identity = results.get(c.address) ?? null;
      setIdentity(c.id, identity);
    }
    // Show 100% briefly so the user sees the completion state
    setTimeout(() => setSyncProgress(null), 800);
  };

  const handleExport = () => {
    downloadContactsAsJson(exportContacts());
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await readContactsImportFile(file, importContacts);
    setImportResult(result);
    setTimeout(() => setImportResult(null), 5000);
    // Reset input so the same file can be chosen again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSelect = (address: string) => {
    setContactSearch('');
    onSelectContact(address);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Address book">
      <div className="space-y-3">
        {/* Search + Add button row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="input-base pl-9 py-2.5 text-sm"
              placeholder="Search contacts…"
            />
          </div>
          <button
            onClick={onOpenAdd}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-xx-500 text-ink-950 font-medium text-sm active:bg-xx-600"
          >
            <Plus size={16} strokeWidth={2.5} />
            Add
          </button>
        </div>

        {/* Utility row — sync identities, import, export */}
        {contacts.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncIdentities}
              disabled={syncProgress !== null}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-xs font-medium text-ink-200 disabled:opacity-60"
            >
              {syncProgress !== null ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Syncing {syncProgress.done}/{syncProgress.total}
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  Sync identities
                </>
              )}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-xs font-medium text-ink-200"
            >
              <Upload size={14} />
              Import
            </button>
            <button
              onClick={handleExport}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-xs font-medium text-ink-200"
            >
              <DownloadIcon size={14} />
              Export
            </button>
          </div>
        )}

        {/* Import-only button for empty state */}
        {contacts.length === 0 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-xs font-medium text-ink-200"
          >
            <Upload size={14} />
            Import contacts from JSON
          </button>
        )}

        {/* Hidden file input for import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportFile}
          className="hidden"
        />

        {/* Import result toast */}
        {importResult && (
          <div className={clsx(
            'flex items-start gap-2 p-3 rounded-xl text-xs',
            importResult.added > 0
              ? 'bg-xx-500/10 border border-xx-500/30 text-ink-200'
              : 'bg-danger/10 border border-danger/30 text-ink-200'
          )}>
            {importResult.added > 0 ? (
              <Check size={14} className="text-xx-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="text-danger flex-shrink-0 mt-0.5" />
            )}
            <div className="leading-relaxed">
              {importResult.added > 0 && (
                <p>Imported <span className="font-medium">{importResult.added}</span> new contact{importResult.added === 1 ? '' : 's'}.</p>
              )}
              {importResult.skipped > 0 && (
                <p className="text-ink-400">Skipped {importResult.skipped} duplicate{importResult.skipped === 1 ? '' : 's'}.</p>
              )}
              {importResult.errors > 0 && (
                <p className="text-danger/90">{importResult.errors} invalid entr{importResult.errors === 1 ? 'y' : 'ies'} skipped.</p>
              )}
              {importResult.added === 0 && importResult.skipped === 0 && importResult.errors === 0 && (
                <p className="text-ink-400">No valid contacts found in the file.</p>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {contacts.length === 0 && (
          <div className="flex flex-col items-center text-center py-8 gap-3">
            <UserCircle2 size={40} className="text-ink-600" strokeWidth={1.25} />
            <div>
              <p className="font-medium text-ink-300 text-sm">No contacts yet</p>
              <p className="text-xs text-ink-500 mt-1 max-w-xs">
                Save addresses you send to frequently so you don't have to type them each time.
              </p>
            </div>
          </div>
        )}

        {contacts.length > 0 && filteredContacts.length === 0 && (
          <p className="text-center text-sm text-ink-400 py-4">
            No contacts match "{contactSearch}"
          </p>
        )}

        {/* Contacts list */}
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
          {filteredContacts.map((c) => (
            <li
              key={c.id}
              className={clsx(
                'p-3 rounded-2xl bg-ink-800 border',
                c.address === currentRecipient.trim()
                  ? 'border-xx-500/40'
                  : 'border-ink-700/50'
              )}
            >
              <button
                onClick={() => handleSelect(c.address)}
                className="w-full flex items-center gap-3 text-left active:opacity-80"
              >
                <AddressIcon address={c.address} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {c.name || c.identity?.display || (
                        <span className="text-ink-400 font-mono text-xs">{shortenAddress(c.address)}</span>
                      )}
                    </p>
                    {isVerifiedJudgement(c.identity?.judgement) && (
                      <BadgeCheck size={14} className="text-xx-500 flex-shrink-0" strokeWidth={2} />
                    )}
                  </div>
                  {c.name && c.identity?.display && c.identity.display !== c.name && (
                    <p className="text-xs text-ink-400 truncate">
                      on-chain: {c.identity.display}
                    </p>
                  )}
                  <p className="font-mono text-xs text-ink-500 truncate">
                    {shortenAddress(c.address, { start: 8, end: 6 })}
                  </p>
                  {c.note && (
                    <p className="text-xs text-ink-500 truncate">{c.note}</p>
                  )}
                </div>
              </button>
              {/* Inline actions */}
              <div className="flex items-center gap-2 pt-2 mt-2 border-t border-ink-700/50">
                <button
                  onClick={() => handleSelect(c.address)}
                  className="flex-1 text-xs font-medium text-xx-500 py-1 active:opacity-70"
                >
                  Use
                </button>
                <div className="w-px h-4 bg-ink-700" />
                <button
                  onClick={async () => {
                    await copyToClipboard(c.address);
                  }}
                  className="flex-1 flex items-center justify-center gap-1 text-xs font-medium text-ink-300 py-1 active:opacity-70"
                >
                  <Copy size={11} />Copy
                </button>
                <div className="w-px h-4 bg-ink-700" />
                <button
                  onClick={() => onOpenDetails(c.id)}
                  className="flex-1 flex items-center justify-center gap-1 text-xs font-medium text-ink-300 py-1 active:opacity-70"
                >
                  <Edit2 size={11} />Details
                </button>
                <div className="w-px h-4 bg-ink-700" />
                <button
                  onClick={() => onRequestDelete(c.id)}
                  className="flex-1 flex items-center justify-center gap-1 text-xs font-medium text-danger/80 py-1 active:opacity-70"
                >
                  <Trash2 size={11} />Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
