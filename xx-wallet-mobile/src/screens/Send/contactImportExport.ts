/**
 * Contact import/export helpers — pure file IO, no React state.
 *
 * The store's `importContacts`/`exportContacts` actions handle the in-memory
 * mutation. These helpers handle the file-system side: building the JSON blob
 * + triggering the download for export, and parsing the uploaded file for
 * import (then handing the parsed payload to the store action).
 */

import type { ExportedContact } from '@/store';

export type ContactImportResult = {
  added: number;
  skipped: number;
  errors: number;
};

/**
 * Trigger a browser download of the contacts list as a JSON file.
 * Filename: `xx-wallet-contacts-YYYY-MM-DD.json`. No-op if the list is empty.
 */
export function downloadContactsAsJson(contacts: ExportedContact[]): void {
  if (contacts.length === 0) return;
  const blob = new Blob([JSON.stringify(contacts, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `xx-wallet-contacts-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Read a user-selected JSON file, parse it, and pass the parsed payload to
 * the store's `importContacts` action. Returns the import-counts result.
 *
 * If the file isn't valid JSON, returns `{ added: 0, skipped: 0, errors: 1 }`
 * so the caller can surface a single error toast without throwing.
 */
export async function readContactsImportFile(
  file: File,
  importContacts: (json: unknown) => ContactImportResult
): Promise<ContactImportResult> {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    return importContacts(json);
  } catch {
    return { added: 0, skipped: 0, errors: 1 };
  }
}
