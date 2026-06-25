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
import {
  useAccountsStore,
  useConnectionStore,
  useInstallStore,
  useSettingsStore,
  useLockStore,
  type BeforeInstallPromptEvent,
} from '@/store';
import { xxApi } from '@/api';
import { AppLayout, OnboardingLayout } from '@/components/layout';
import { IOSInstallBanner, UpdateBanner, WhatsNewSheet, TxToastHost } from '@/components/ui';
import { LockScreen, LockController } from '@/components/lock';
import { Welcome, CreateWallet, ImportWallet } from '@/screens/Onboarding';
import { Dashboard } from '@/screens/Dashboard';
import { Send } from '@/screens/Send';
import { Receive } from '@/screens/Receive';
import { Settings } from '@/screens/Settings';
import { Memos } from '@/screens/Memos';
import { Chat } from '@/screens/Memos/Chat';
import { AccountDetail } from '@/screens/AccountDetail';
import { AddLedgerAccount } from '@/screens/AddLedgerAccount';
import {
  StakingLayout,
  MyNominations,
  ValidatorList,
  ValidatorDetail,
  RewardsHistory,
  StartStaking,
  AddToStake,
  ChangeValidators,
  StopNominating,
  UnbondAmount,
  WithdrawUnbonded,
  ValidatorSetup,
  ChangeCmixId,
  TransferCmixId,
} from '@/screens/Staking';
import { TransactionDetail } from '@/screens/TransactionDetail';
import {
  GovernanceIndex,
  BountiesList,
  BountyDetail,
  DemocracyOverview,
  ReferendumDetail,
  CouncilOverview,
  TreasuryOverview,
  MyGovernance,
} from '@/screens/Governance';
import { MultisigCreate } from '@/screens/MultisigCreate';
import { MultisigDetail } from '@/screens/MultisigDetail';
import { MultisigApprove } from '@/screens/MultisigApprove';
import { MultisigPropose } from '@/screens/MultisigPropose';
import { MultisigShare } from '@/screens/MultisigShare';
import { MultisigImport } from '@/screens/MultisigImport';
import { MultisigScan } from '@/screens/MultisigScan';
import { TwoDeviceApproval } from '@/screens/TwoDeviceApproval';
import {
  inlineSink,
  registerSink,
  useCmixReceive,
  useCmixChatReceive,
  useGovernanceNotifications,
  useMultisigNotifications,
  useSlashNotifications,
} from '@/notifications';

// Register the wallet-inline sink at module load. Pushes slash events
// into useAlertsStore so RecentAlertsBanner can render them without
// any plugin sink configured.
registerSink(inlineSink);

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
 *
 * Also the mount point for app-wide notification wiring: the multisig
 * notification hook lives here so it runs for every authenticated session
 * (and never during onboarding, when the user has no multisigs anyway).
 */
function RequireAccount() {
  const accounts = useAccountsStore((s) => s.accounts);
  const lockMode = useSettingsStore((s) => s.appLock.mode);
  const isUnlocked = useLockStore((s) => s.isUnlocked);
  const location = useLocation();
  // Hook order: call before the conditional return so React's hook
  // rules don't trip when the user is in the onboarding redirect path.
  useMultisigNotifications();
  useSlashNotifications();
  useGovernanceNotifications();
  // Pre-load call data from cosigner memos received over cMix (so the approval
  // screen is ready without a file import). No-op until messaging is online.
  useCmixReceive();
  // Store incoming 1:1 chat memos into the local conversation log.
  useCmixChatReceive();
  if (accounts.length === 0) {
    return <Navigate to="/onboarding" replace state={{ from: location }} />;
  }
  // Opt-in app lock — gate the whole authenticated app behind unlock.
  if (lockMode !== 'off' && !isUnlocked) {
    return <LockScreen />;
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
      const startedAt = Date.now();
      // Initialize crypto + keyring before anything else
      await xxKeyring.init();
      refreshAccounts();

      // Ensure the API connects to the user's chosen endpoint
      xxApi.connect(endpoint).catch((err) => {
        console.error('Initial API connection failed', err);
      });

      // Hold the loading state for a minimum perceptible duration so
      // the launch feels deliberate rather than flashing-by. On fast
      // devices xxKeyring.init() completes in <100ms which makes the
      // brand-splash + loading state nearly invisible. On slower
      // devices init takes longer than MIN_LOADING_MS so this is a
      // no-op there. The wait fires AFTER the work completes so we're
      // never blocking the user — just smoothing the perception.
      const MIN_LOADING_MS = 1200;
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_LOADING_MS - elapsed)
        );
      }

      setInitialized(true);
    })();
  }, [endpoint, refreshAccounts]);

  useEffect(() => {
    if (!initialized) return;
    return initConnection();
  }, [initialized, initConnection]);

  // Capture Chrome's beforeinstallprompt event so Settings can offer a
  // manual Install button for users whose Chrome didn't auto-prompt.
  // iOS Safari doesn't fire this event — the iOSInstallBanner component
  // handles that path separately.
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      useInstallStore
        .getState()
        .setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    // Also clear the captured prompt once the PWA is installed —
    // Chrome fires 'appinstalled' on successful install.
    const onInstalled = () => {
      useInstallStore.getState().setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!initialized) {
    return (
      <div role="main" className="min-h-screen bg-ink-950 flex items-center justify-center">
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
            <p className="text-xs text-ink-300 animate-pulse-subtle">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      {/* PWA lifecycle UI — all three are top-level so they render
          regardless of route. UpdateBanner shows when a new SW is
          waiting; WhatsNewSheet shows on the first launch after a
          version bump in src/release/version.ts; IOSInstallBanner
          shows on pre-install Safari sessions. In practice
          UpdateBanner and IOSInstallBanner don't overlap (one is
          for installed PWAs, the other for non-installed Safari). */}
      <UpdateBanner />
      <WhatsNewSheet />
      <IOSInstallBanner />
      <LockController />
      {/* App-wide tx toasts — track a transaction to finality even after the
          user navigates away from the screen that submitted it. */}
      <TxToastHost />
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
            <Route path="/account/ledger/add" element={<AddLedgerAccount />} />
            <Route path="/account/:address" element={<AccountDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/memos" element={<Memos />} />
            <Route path="/memos/:account" element={<Chat />} />
            <Route path="/staking" element={<StakingLayout />}>
              <Route index element={<MyNominations />} />
              <Route path="validators" element={<ValidatorList />} />
              <Route path="rewards" element={<RewardsHistory />} />
            </Route>
            <Route
              path="/staking/validators/:address"
              element={<ValidatorDetail />}
            />
            <Route path="/staking/start" element={<StartStaking />} />
            <Route path="/staking/add" element={<AddToStake />} />
            <Route path="/staking/change" element={<ChangeValidators />} />
            <Route path="/staking/chill" element={<StopNominating />} />
            <Route path="/staking/unbond" element={<UnbondAmount />} />
            <Route path="/staking/withdraw" element={<WithdrawUnbonded />} />
            <Route path="/staking/validate" element={<ValidatorSetup />} />
            <Route path="/staking/cmix" element={<ChangeCmixId />} />
            <Route path="/staking/cmix/transfer" element={<TransferCmixId />} />
            <Route path="/governance" element={<GovernanceIndex />} />
            <Route path="/governance/bounties" element={<BountiesList />} />
            <Route
              path="/governance/bounties/:id"
              element={<BountyDetail />}
            />
            <Route
              path="/governance/democracy"
              element={<DemocracyOverview />}
            />
            <Route
              path="/governance/democracy/:id"
              element={<ReferendumDetail />}
            />
            <Route
              path="/governance/council"
              element={<CouncilOverview />}
            />
            <Route
              path="/governance/treasury"
              element={<TreasuryOverview />}
            />
            <Route path="/governance/me" element={<MyGovernance />} />
            <Route path="/tx/:id" element={<TransactionDetail />} />
            <Route path="/multisig/two-device" element={<TwoDeviceApproval />} />
            <Route path="/multisig/create" element={<MultisigCreate />} />
            <Route path="/multisig/import" element={<MultisigImport />} />
            <Route path="/multisig/scan" element={<MultisigScan />} />
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
