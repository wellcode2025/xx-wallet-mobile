import { Link } from 'react-router-dom';
import { ArrowRight, Download, Plus } from 'lucide-react';

/**
 * The first thing a user sees when they have no accounts.
 * Two paths: create a new wallet, or import an existing one.
 */
export function Welcome() {
  return (
    <div className="flex flex-col min-h-screen p-6 safe-area">
      {/* Hero */}
      <div className="flex-1 flex flex-col justify-center items-center text-center gap-4">
        <div className="relative">
          {/* Concentric brand rings around the official xx network mark */}
          <div className="w-24 h-24 rounded-full border-2 border-xx-500/40 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-xx-500/10 flex items-center justify-center">
              <img
                src="/brand/icon-color.svg"
                alt=""
                className="w-11 h-11"
                draggable={false}
              />
            </div>
          </div>
          {/* Orbital dot */}
          <div className="absolute -top-1 right-0 w-2 h-2 rounded-full bg-xx-500 animate-pulse-subtle" />
        </div>

        <div className="space-y-2 mt-8 max-w-xs">
          <h1 className="font-display font-semibold text-3xl tracking-tight">
            xx Wallet
          </h1>
          <p className="text-ink-300 text-base leading-relaxed">
            A mobile-native wallet for the quantum-ready xx network.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3 pb-6">
        <Link to="/onboarding/create" className="btn-primary w-full">
          <Plus size={18} strokeWidth={2} />
          Create new wallet
          <ArrowRight size={18} strokeWidth={2} />
        </Link>
        <Link to="/onboarding/import" className="btn-secondary w-full">
          <Download size={18} strokeWidth={2} />
          Import existing wallet
        </Link>
        <p className="text-center text-xs text-ink-400 pt-2 px-4 leading-relaxed">
          Your keys never leave this device. Back up your recovery phrase —
          losing it means losing access to your funds.
        </p>
      </div>
    </div>
  );
}
