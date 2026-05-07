/**
 * QrScanner — camera-based QR code reader with HTTP fallback.
 *
 * Camera access via getUserMedia() requires HTTPS (or localhost).
 * When running over plain HTTP on a local network, camera is unavailable.
 * In that case we show a manual paste input instead.
 */

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, ClipboardPaste, AlertTriangle } from 'lucide-react';
import { isValidXxAddress } from '@/utils/address';
import clsx from 'clsx';

interface QrScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const containerId = 'qr-scanner-container';
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Check if camera is even possible before trying
  const cameraAvailable = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!cameraAvailable) {
      setManualMode(true);
      setStarting(false);
      return;
    }

    let scanner: Html5Qrcode | null = null;
    let cancelled = false;

    const start = async () => {
      try {
        scanner = new Html5Qrcode(containerId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
          (decodedText) => {
            const clean = decodedText.replace(/^[a-z]+:/i, '').trim();
            onScan(clean);
          },
          () => { /* scan failure — keep trying */ }
        );
        if (!cancelled) setStarting(false);
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error).message ?? String(err);
        if (
          msg.toLowerCase().includes('permission') ||
          msg.toLowerCase().includes('denied')
        ) {
          setError('Camera permission denied. You can paste the address manually instead.');
        } else if (
          msg.toLowerCase().includes('not supported') ||
          msg.toLowerCase().includes('secure')
        ) {
          setManualMode(true);
        } else {
          setError(`Camera unavailable: ${msg}`);
        }
        setStarting(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, [cameraAvailable, onScan]);

  const handleManualSubmit = () => {
    const trimmed = manualInput.trim();
    if (!isValidXxAddress(trimmed)) {
      setManualError('Not a valid xx network address. Addresses start with "6".');
      return;
    }
    onScan(trimmed);
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        const text = await navigator.clipboard.readText();
        setManualInput(text.trim());
        setManualError(null);
      }
    } catch {
      // Clipboard read not available — user can type manually
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-950 flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}
      >
        <h2 className="font-display font-medium text-lg">
          {manualMode ? 'Paste address' : 'Scan QR code'}
        </h2>
        <button onClick={onClose} className="p-2 rounded-full active:bg-ink-800" aria-label="Close">
          <X size={22} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 gap-6">

        {/* Manual paste mode — shown on HTTP or when camera fails */}
        {manualMode ? (
          <div className="w-full max-w-xs space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-warning/10 border border-warning/30">
              <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-300 leading-relaxed">
                Camera requires HTTPS. You can paste the recipient's address below instead.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
                Recipient address
              </label>
              <textarea
                value={manualInput}
                onChange={(e) => { setManualInput(e.target.value); setManualError(null); }}
                className="input-base min-h-[100px] py-3 font-mono text-sm resize-none"
                placeholder="6…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              {manualError && (
                <p className="text-xs text-danger mt-1.5">{manualError}</p>
              )}
            </div>

            <button
              onClick={handlePasteFromClipboard}
              className="btn-ghost w-full text-ink-300"
            >
              <ClipboardPaste size={16} />
              Paste from clipboard
            </button>

            <button
              onClick={handleManualSubmit}
              disabled={!manualInput.trim()}
              className="btn-primary w-full"
            >
              Use this address
            </button>
          </div>
        ) : error ? (
          /* Camera error with manual fallback option */
          <div className="text-center space-y-4 max-w-xs">
            <Camera size={48} className="text-ink-500 mx-auto" strokeWidth={1.25} />
            <p className="text-sm text-ink-300">{error}</p>
            <button onClick={() => setManualMode(true)} className="btn-primary w-full">
              <ClipboardPaste size={18} />
              Paste address instead
            </button>
            <button onClick={onClose} className="btn-ghost w-full">
              Go back
            </button>
          </div>
        ) : (
          /* Camera scanning mode */
          <>
            <div className="relative w-full max-w-xs">
              <div
                id={containerId}
                className={clsx(
                  'w-full rounded-2xl overflow-hidden',
                  starting && 'bg-ink-800 aspect-square'
                )}
              />
              {!starting && (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-xx-500 rounded-tl-lg" />
                  <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-xx-500 rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-xx-500 rounded-bl-lg" />
                  <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-xx-500 rounded-br-lg" />
                </div>
              )}
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Camera size={40} className="text-ink-500 animate-pulse-subtle" />
                </div>
              )}
            </div>
            <p className="text-sm text-ink-400 text-center">
              Point your camera at an xx network address QR code
            </p>
            <button onClick={() => setManualMode(true)} className="btn-ghost text-ink-400">
              <ClipboardPaste size={16} />
              Paste address instead
            </button>
          </>
        )}
      </div>
    </div>
  );
}
