import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Share2, Mail, Send, MessageCircle } from 'lucide-react';
import { useAccountsStore } from '@/store';
import { TopBar } from '@/components/layout';
import { AddressIcon, Sheet } from '@/components/ui';
import { copyToClipboard } from '@/utils/clipboard';

export function Receive() {
  const { accounts, activeAddress } = useAccountsStore();
  const active = accounts.find((a) => a.address === activeAddress) ?? accounts[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!active || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, active.address, {
      width: 260,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch((err) => console.error('QR render failed', err));
  }, [active]);

  const handleCopy = async () => {
    if (!active) return;
    const success = await copyToClipboard(active.address);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleShare = async () => {
    if (!active) return;
    if (navigator.share && window.isSecureContext) {
      try {
        await navigator.share({ title: 'My xx network address', text: active.address });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    setShareOpen(true);
  };

  const shareVia = async (method: string) => {
    if (!active) return;
    const addr = active.address;
    const message = `My xx network address: ${addr}`;
    const encoded = encodeURIComponent(message);

    if (method === 'copy') {
      await copyToClipboard(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      setShareOpen(false);
      return;
    }

    const urls: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${encoded}`,
      telegram: `tg://msg?text=${encoded}`,
      email: `mailto:?subject=My%20xx%20network%20address&body=${encoded}`,
    };

    const url = urls[method];
    if (url) {
      // Use window.open for all share targets, including tg://. The previous
      // approach of `window.location.href = 'tg://...'` would replace the
      // current document on some browsers — if Telegram isn't installed the
      // user got stuck on a broken page. window.open hands the URL to the
      // OS protocol handler without navigating the wallet away.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setShareOpen(false);
  };

  if (!active) return null;

  return (
    <>
      <TopBar title="Receive" showBack />
      <div className="px-5 py-6 max-w-md mx-auto space-y-6">
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-ink-900 border border-ink-800">
          <AddressIcon address={active.address} size={40} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{active.name}</p>
            <p className="text-xs text-ink-400">Your xx network address</p>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div className="p-4 rounded-3xl bg-white">
            <canvas ref={canvasRef} className="block" />
          </div>
          <p className="mt-4 text-xs text-ink-400 text-center max-w-xs">
            Scan with another xx wallet or share the address below.
          </p>
        </div>

        <div className="card">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-2">
            Full address
          </p>
          <p className="font-mono text-xs text-ink-100 break-all leading-relaxed select-all">
            {active.address}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleCopy} className="btn-secondary">
            {copied ? (
              <><Check size={18} className="text-xx-500" />Copied!</>
            ) : (
              <><Copy size={18} />Copy</>
            )}
          </button>
          <button onClick={handleShare} className="btn-secondary">
            <Share2 size={18} />Share
          </button>
        </div>
      </div>

      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Share address">
        <div className="space-y-3">
          <p className="text-xs text-ink-400 font-mono break-all bg-ink-900 rounded-xl p-3">
            {active.address}
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <ShareBtn label="Copy" icon={<Copy size={20} strokeWidth={1.75} />} onClick={() => shareVia('copy')} />
            <ShareBtn label="WhatsApp" icon={<MessageCircle size={20} strokeWidth={1.75} />} onClick={() => shareVia('whatsapp')} />
            <ShareBtn label="Telegram" icon={<Send size={20} strokeWidth={1.75} />} onClick={() => shareVia('telegram')} />
            <ShareBtn label="Email" icon={<Mail size={20} strokeWidth={1.75} />} onClick={() => shareVia('email')} />
          </div>
        </div>
      </Sheet>
    </>
  );
}

function ShareBtn({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 transition-colors"
    >
      <div className="text-ink-300">{icon}</div>
      <p className="text-xs font-medium text-ink-200">{label}</p>
    </button>
  );
}
