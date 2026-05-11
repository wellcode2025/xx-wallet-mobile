import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { xxKeyring } from '@/keyring';
import { useAccountsStore, useConnectionStore, useSettingsStore } from '@/store';
import { xxApi } from '@/api';
import { AppLayout, OnboardingLayout } from '@/components/layout';
import { Welcome, CreateWallet, ImportWallet } from '@/screens/Onboarding';
import { Dashboard } from '@/screens/Dashboard';
import { Send } from '@/screens/Send';
import { Receive } from '@/screens/Receive';
import { Settings } from '@/screens/Settings';
import { TransactionDetail } from '@/screens/TransactionDetail';
import { MultisigCreate } from '@/screens/MultisigCreate';
import { MultisigDetail } from '@/screens/MultisigDetail';
import { MultisigApprove } from '@/screens/MultisigApprove';
import { MultisigPropose } from '@/screens/MultisigPropose';
import { MultisigShare } from '@/screens/MultisigShare';

/**
 * Resets scroll to the top on forward navigation (PUSH/REPLACE). Without
 * this, react-router preserves the previous page's scroll Y, which is jarring
 * on drill-down screens (e.g. tap a transaction near the bottom of the list,
 * land halfway down the detail screen).
 *
 * On POP (browser back/forward), we deliberately do NOT scroll, so going
 * back to the dashboard restores your position in the transaction list.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType !== 'POP') {
      window.scrollTo(0, 0);
    }
  }, [pathname, navType]);
  return null;
}

/**
 * Guards the main app routes — if no accounts exist, redirect to onboarding.
 */
function RequireAccount() {
  const accounts = useAccountsStore((s) => s.accounts);
  const location = useLocation();
  if (accounts.length === 0) {
    return <Navigate to="/onboarding" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * If accounts already exist, skip onboarding and go straight to the wallet.
 */
function RedirectIfAccount() {
  const accounts = useAccountsStore((s) => s.accounts);
  if (accounts.length > 0) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export function App() {
  const [initialized, setInitialized] = useState(false);
  const refreshAccounts = useAccountsStore((s) => s.refresh);
  const initConnection = useConnectionStore((s) => s.init);
  const endpoint = useSettingsStore((s) => s.endpoint);

  useEffect(() => {
    (async () => {
      // Initialize crypto + keyring before anything else
      await xxKeyring.init();
      refreshAccounts();

      // Ensure the API connects to the user's chosen endpoint
      xxApi.connect(endpoint).catch((err) => {
        console.error('Initial API connection failed', err);
      });

      setInitialized(true);
    })();
  }, [endpoint, refreshAccounts]);

  useEffect(() => {
    if (!initialized) return;
    return initConnection();
  }, [initialized, initConnection]);

  if (!initialized) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <img
            src="/brand/icon-color.svg"
            alt=""
            className="w-20 h-20"
            draggable={false}
          />
          <div className="flex flex-col items-center gap-1">
            <p className="font-display font-medium text-xl tracking-tight text-ink-100">
              xx Wallet
            </p>
            <p className="text-xs text-ink-500 animate-pulse-subtle">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* Onboarding flow */}
        <Route element={<OnboardingLayout />}>
          <Route element={<RedirectIfAccount />}>
            <Route path="/onboarding" element={<Welcome />} />
          </Route>
          {/* Create & import are also reachable from Settings > Add,
              so they don't redirect even if an account already exists. */}
          <Route path="/onboarding/create" element={<CreateWallet />} />
          <Route path="/onboarding/import" element={<ImportWallet />} />
        </Route>

        {/* Main app */}
        <Route element={<RequireAccount />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="/send" element={<Send />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/tx/:id" element={<TransactionDetail />} />
            <Route path="/multisig/create" element={<MultisigCreate />} />
            <Route path="/multisig/:address" element={<MultisigDetail />} />
            <Route
              path="/multisig/:address/propose"
              element={<MultisigPropose />}
            />
            <Route
              path="/multisig/:address/approve/:callHash"
              element={<MultisigApprove />}
            />
            <Route
              path="/multisig/:address/share/:callHash"
              element={<MultisigShare />}
            />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
