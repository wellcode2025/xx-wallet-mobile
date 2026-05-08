import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Upload, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { xxKeyring } from '@/keyring';
import { useAccountsStore } from '@/store';
import { TopBar } from '@/components/layout';
import { isCommonPassword } from '@/utils';
import clsx from 'clsx';

type Method = 'mnemonic' | 'json';

export function ImportWallet() {
  const navigate = useNavigate();
  const refreshAccounts = useAccountsStore((s) => s.refresh);

  const [method, setMethod] = useState<Method>('mnemonic');
  const [name, setName] = useState('Imported account');
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [jsonContent, setJsonContent] = useState<string | null>(null);
  const [jsonFilename, setJsonFilename] = useState<string | null>(null);
  const [jsonPassword, setJsonPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
    setImporting(true);
    try {
      await xxKeyring.importFromJson({
        json: parsed,
        password: jsonPassword,
      });
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
                  : 'text-ink-400 active:bg-ink-700'
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
              <p className="text-xs text-ink-400 mt-1.5">
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-ink-400"
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
            <label className="w-full card flex flex-col items-center justify-center gap-3 py-8 border-dashed active:bg-ink-700/50 cursor-pointer">
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              {jsonFilename ? (
                <>
                  <FileText size={32} className="text-xx-500" strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="font-mono text-sm text-ink-100">{jsonFilename}</p>
                    <p className="text-xs text-ink-400 mt-1">Tap to change</p>
                  </div>
                </>
              ) : (
                <>
                  <Upload size={32} className="text-ink-400" strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="font-medium text-ink-200">Select keystore file</p>
                    <p className="text-xs text-ink-400 mt-1">
                      .json file exported from the xx wallet
                    </p>
                  </div>
                </>
              )}
            </label>

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
