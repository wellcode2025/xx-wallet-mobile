import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Upload, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { xxKeyring } from '@/keyring';
import { useAccountsStore } from '@/store';
import { TopBar } from '@/components/layout';
import { isCommonPassword, parseMultisigConfig } from '@/utils';
import clsx from 'clsx';

type Method = 'mnemonic' | 'json';

/**
 * sessionStorage keys for the in-progress form state. We persist
 * just enough of the form to survive a mobile-browser tab suspension
 * during the OS file picker — iOS Safari (and Android Chrome under
 * memory pressure) will kill and re-launch the tab between "tap to
 * select file" and "file picked," which would otherwise blow away
 * React state and snap the user back to a blank Recovery phrase tab.
 *
 * What we DO persist: which tab the user is on, the file contents
 * once read, and the filename label (so the upload card still shows
 * "tap to change" instead of "select keystore file"). All three are
 * either non-secret or already-encrypted-at-rest material.
 *
 * What we DON'T persist: passwords. The keystore JSON encrypts the
 * key with whatever password was used at export time; sticking it
 * in sessionStorage doesn't change that property. But the user's
 * keystroke-level password (here or anywhere else) should live in
 * React memory only and be wiped on a real submit failure or
 * navigation.
 */
const STORAGE_KEY_METHOD = 'xx-wallet:import:method';
const STORAGE_KEY_JSON_CONTENT = 'xx-wallet:import:jsonContent';
const STORAGE_KEY_JSON_FILENAME = 'xx-wallet:import:jsonFilename';

export function ImportWallet() {
  const navigate = useNavigate();
  const refreshAccounts = useAccountsStore((s) => s.refresh);

  // Lazy initializers read from sessionStorage so the form lands in
  // its pre-suspension state on first render, before any effect can
  // cause a visible flicker.
  const [method, setMethod] = useState<Method>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_METHOD);
      return saved === 'json' || saved === 'mnemonic' ? saved : 'mnemonic';
    } catch {
      return 'mnemonic';
    }
  });
  const [name, setName] = useState('Imported account');
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [jsonContent, setJsonContent] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_JSON_CONTENT);
    } catch {
      return null;
    }
  });
  const [jsonFilename, setJsonFilename] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_JSON_FILENAME);
    } catch {
      return null;
    }
  });
  const [jsonPassword, setJsonPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // File input ref + programmatic click — replaces the previous
  // <label>-wraps-<input> pattern. The label pattern occasionally
  // misfires on mobile browsers when the label is large or nested,
  // sending the user back to whatever the default tab was. The
  // ref+button pattern (same one MultisigImport uses) is more
  // battle-tested across the file-picker focus-return lifecycle.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Mirror the persisted bits to sessionStorage as they change. Three
  // small writes; storage events fire only on writes that change the
  // value, so this is cheap.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_METHOD, method);
    } catch {
      // Quota or storage disabled — non-fatal; the form just won't
      // survive a suspension. The actual import still works.
    }
  }, [method]);

  useEffect(() => {
    try {
      if (jsonContent) sessionStorage.setItem(STORAGE_KEY_JSON_CONTENT, jsonContent);
      else sessionStorage.removeItem(STORAGE_KEY_JSON_CONTENT);
    } catch {
      /* see above */
    }
  }, [jsonContent]);

  useEffect(() => {
    try {
      if (jsonFilename) sessionStorage.setItem(STORAGE_KEY_JSON_FILENAME, jsonFilename);
      else sessionStorage.removeItem(STORAGE_KEY_JSON_FILENAME);
    } catch {
      /* see above */
    }
  }, [jsonFilename]);

  /**
   * Clear the persisted import state. Called on successful import
   * (so a future visit starts clean) and reachable from explicit
   * cancellation paths if we add any.
   */
  const clearPersistedImport = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY_METHOD);
      sessionStorage.removeItem(STORAGE_KEY_JSON_CONTENT);
      sessionStorage.removeItem(STORAGE_KEY_JSON_FILENAME);
    } catch {
      // ignore
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setJsonContent(reader.result as string);
      setJsonFilename(file.name);
      setError(null);
    };
    reader.onerror = () => setError('Could not read file.');
    reader.readAsText(file);
  };

  const mnemonicValid = mnemonic.trim().split(/\s+/).length >= 12;
  // L-3: refuse common passwords on the new-password (mnemonic-import) path.
  // The keystore-import path doesn't use this — that password is set by
  // whoever exported the JSON, and we can't change theirs.
  const passwordTooCommon = password.length > 0 && isCommonPassword(password);
  const mnemonicReady =
    mnemonicValid &&
    name.trim().length > 0 &&
    password.length >= 8 &&
    password === passwordConfirm &&
    !passwordTooCommon;

  const handleImportMnemonic = async () => {
    setError(null);
    if (!xxKeyring.validateMnemonic(mnemonic)) {
      setError('Invalid recovery phrase. Check the words and spacing.');
      return;
    }
    setImporting(true);
    try {
      await xxKeyring.createFromMnemonic(mnemonic, {
        name: name.trim(),
        password,
      });
      clearPersistedImport();
      refreshAccounts();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setImporting(false);
    }
  };

  const handleImportJson = async () => {
    setError(null);
    if (!jsonContent) {
      setError('Select a keystore file first.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      setError('The selected file is not a valid JSON keystore.');
      return;
    }

    // Guard against the user picking a multisig CONFIG JSON during
    // onboarding. Those don't have a password (the config is plaintext)
    // AND can't function as a first wallet — a multisig is reachable
    // only when one of its signers exists locally. Detect and route
    // the user to the right place.
    const asMultisig = parseMultisigConfig(parsed);
    if (asMultisig.ok) {
      setError(
        'This looks like a multisig config, not a keystore. Finish ' +
          'setting up your first account here, then use "Add multisig" ' +
          'from the Dashboard.'
      );
      return;
    }

    // Basic shape check — a polkadot.js v3 keystore has `encoded` and
    // `encoding` at minimum. Reject early with a friendly message
    // instead of letting xxKeyring.importFromJson throw a cryptic
    // decode error.
    const looksLikeKeystore =
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.encoded === 'string' &&
      typeof parsed.encoding === 'object' &&
      typeof parsed.address === 'string';
    if (!looksLikeKeystore) {
      setError(
        "This doesn't look like a wallet keystore. Expecting a JSON " +
          'file exported from xx Wallet, wallet.xx.network, or ' +
          'polkadot.js — with an encoded key and an address field.'
      );
      return;
    }

    setImporting(true);
    try {
      await xxKeyring.importFromJson({
        json: parsed,
        password: jsonPassword,
      });
      // Clear in-progress form persistence — a successful import means
      // the JSON / filename in sessionStorage is no longer needed and
      // shouldn't dangle into a future visit.
      clearPersistedImport();
      refreshAccounts();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setImporting(false);
    }
  };

  return (
    <>
      <TopBar title="Import wallet" showBack showConnection={false} />
      <div className="px-6 py-6 max-w-md mx-auto space-y-6">
        {/* Method selector */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-ink-800 border border-ink-700/50">
          {(['mnemonic', 'json'] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMethod(m);
                setError(null);
              }}
              className={clsx(
                'py-2.5 px-4 rounded-xl text-sm font-medium transition-colors',
                method === m
                  ? 'bg-ink-600 text-ink-100'
                  : 'text-ink-300 active:bg-ink-700'
              )}
            >
              {m === 'mnemonic' ? 'Recovery phrase' : 'Keystore file'}
            </button>
          ))}
        </div>

        {method === 'mnemonic' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Recovery phrase
              </label>
              <textarea
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                className="input-base min-h-[120px] py-3 font-mono text-sm resize-none"
                placeholder="Enter your 12 or 24 word recovery phrase, separated by spaces"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-xs text-ink-300 mt-1.5">
                {mnemonic.trim().split(/\s+/).filter(Boolean).length} words entered
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Account name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-base"
                maxLength={32}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                New password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-base pr-12"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-ink-300"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordTooCommon && (
                <p className="text-xs text-danger mt-1.5">
                  This password is on a list of commonly-used passwords.
                  Please choose a different one.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Confirm password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="input-base"
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
                <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              onClick={handleImportMnemonic}
              disabled={importing || !mnemonicReady}
              className="btn-primary w-full"
            >
              {importing ? 'Importing…' : 'Import wallet'}
            </button>
          </div>
        )}

        {method === 'json' && (
          <div className="space-y-4">
            {/* File picker — ref+button pattern instead of <label>-wrap.
                The label pattern occasionally misfires on mobile (tab
                gets suspended during the OS picker, comes back to a
                fresh component, and the wrap-click target doesn't
                register on the second tap). Triggering the hidden input
                programmatically via a button click is more reliable. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full card flex flex-col items-center justify-center gap-3 py-8 border-dashed active:bg-ink-700/50"
            >
              {jsonFilename ? (
                <>
                  <FileText size={32} className="text-xx-500" strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="font-mono text-sm text-ink-100">{jsonFilename}</p>
                    <p className="text-xs text-ink-300 mt-1">Tap to change</p>
                  </div>
                </>
              ) : (
                <>
                  <Upload size={32} className="text-ink-400" strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="font-medium text-ink-200">Select keystore file</p>
                    <p className="text-xs text-ink-300 mt-1">
                      .json file exported from the xx wallet
                    </p>
                  </div>
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                // Reset so re-picking the same file fires onChange again.
                e.target.value = '';
              }}
            />

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Password for this keystore
              </label>
              <input
                type="password"
                value={jsonPassword}
                onChange={(e) => setJsonPassword(e.target.value)}
                className="input-base"
                placeholder="The password you used when exporting"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
                <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              onClick={handleImportJson}
              disabled={importing || !jsonContent || !jsonPassword}
              className="btn-primary w-full"
            >
              {importing ? 'Importing…' : 'Import wallet'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
