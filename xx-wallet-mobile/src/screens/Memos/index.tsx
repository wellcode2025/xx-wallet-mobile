/**
 * Memos — the bottom-nav home for private, mixnet-based messaging.
 *
 * Multisig-first: today the live surface is each multisig's "Cosigner
 * messaging" section (go online + coordinate). This tab is the eventual home
 * for direct, account-to-account memos and requests on the same cMix rails —
 * for now it explains the feature and reflects the device-global online state.
 */
import { MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout';
import { useCmixOnlineStore } from '@/store/cmixOnline';

export function Memos() {
  const status = useCmixOnlineStore((s) => s.status);
  const navigate = useNavigate();

  return (
    <>
      <TopBar title="Memos" showSettings />
      <div className="px-5 py-6 max-w-md mx-auto space-y-5">
        <div className="card flex flex-col items-center text-center space-y-3 py-8">
          <div className="w-14 h-14 rounded-2xl bg-xx-500/10 border border-xx-500/30 flex items-center justify-center">
            <MessageSquare size={26} className="text-xx-500" strokeWidth={1.75} />
          </div>
          <div className="space-y-1.5">
            <p className="font-display font-medium text-lg text-ink-100">Private memos</p>
            <p className="text-sm text-ink-300 leading-relaxed">
              Coordinate over the xx mixnet — no group chat, no servers. Today this
              powers multisig coordination; direct account-to-account memos are on
              the way.
            </p>
          </div>
          {status === 'online' ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-xx-500">
              <span className="w-1.5 h-1.5 rounded-full bg-xx-500 flex-shrink-0" />
              You're online
            </span>
          ) : (
            <p className="text-xs text-ink-300">
              Bring messaging online from a multisig's{' '}
              <span className="text-ink-100">Cosigner messaging</span> section.
            </p>
          )}
        </div>

        <button onClick={() => navigate('/')} className="btn-secondary w-full">
          View your multisigs
        </button>
      </div>
    </>
  );
}
