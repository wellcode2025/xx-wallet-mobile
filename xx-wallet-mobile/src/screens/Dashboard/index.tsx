import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookUser,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Usb,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAccountsStore, useMultisigsStore, useSettingsStore } from '@/store';
import { isLedgerSupported } from '@/ledger';
import { isIndexerDisabledError } from '@/api/indexer';
import {
  formatAge,
  useAllPendingMultisigs,
  useBalance,
  useStaleness,
  useTransfers,
} from '@/hooks';
import { formatBalance, splitBalance } from '@/utils';
import { XX_SYMBOL } from '@/api';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressChip, Sheet, TransactionItem } from '@/components/ui';
import clsx from 'clsx';

export function Dashboard() {
  const navigate = useNavigate();
  const { accounts, activeAddress, setActive } = useAccountsStore();
  const multisigs = useMultisigsStore((s) => s.multisigs);
  const { hideBalances, toggleHideBalances } = useSettingsStore();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Chooser sheet for "+ Add multisig" — manual entry vs import from
  // JSON. Chain-scan discovery is added separately.
  const [addChooserOpen, setAddChooserOpen] = useState(false);
  // Chooser sheet for "+ Add account" — Create new (Sleeve) vs
  // Import existing (mnemonic or keystore). Mirrors the Add multisig
  // chooser pattern; reaches the same /onboarding/create and
  // /onboarding/import flows users can already get to from Settings.
  const [addAccountChooserOpen, setAddAccountChooserOpen] = useState(false);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  // Aggregated pending proposals across all multisigs the user is in.
  // Powers the Pending actions section in the switcher sheet.
  const { pending: pendingProposals } = useAllPendingMultisigs();
  const stalenessOf = useStaleness();

  // The switcher sheet always opens — even for a fresh user with one
  // account and zero multisigs, it surfaces the 'Add multisig' CTA which
  // is the entry point into the multisig flow. (Previously gated on
  // hasMoreThanOneEntity, which trapped single-account users.)

  const { balance, isLoading } = useBalance(activeAccount?.address ?? null);
  const { transfers, isLoading: txLoading, error: txError, total: txTotal } = useTransfers(activeAccount?.address ?? null);

  const hero = useMemo(() => {
    if (!balance) return { integer: '0', fraction: '0000' };
    return splitBalance(balance.transferable, 4);
  }, [balance]);

  if (!activeAccount) {
    // Shouldn't happen if the route guard works, but just in case
    return null;
  }

  return (
    <>
      <TopBar
        title="Wallet"
        right={
          <button
            onClick={toggleHideBalances}
            className="p-2 rounded-full active:bg-ink-800"
            aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
          >
            {hideBalances ? (
              <EyeOff size={20} strokeWidth={1.75} />
            ) : (
              <Eye size={20} strokeWidth={1.75} />
            )}
          </button>
        }
      />

      <div className="px-5 py-4 space-y-5">
        {/* Account switcher — gains a small amber badge in the top-right
            corner whenever there's anything in the Pending actions list,
            so the user notices on the next Dashboard open without us
            shoving a banner in their face. The badge disappears when
            there's nothing pending. */}
        <button
          onClick={() => setSwitcherOpen(true)}
          className="relative w-full flex items-center gap-3 p-3 rounded-2xl bg-ink-900 border border-ink-800 active:bg-ink-800"
        >
          {pendingProposals.length > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-ink-950 text-xs font-medium flex items-center justify-center"
              aria-label={`${pendingProposals.length} pending action${
                pendingProposals.length === 1 ? '' : 's'
              }`}
            >
              {pendingProposals.length}
            </span>
          )}
          <AddressIcon address={activeAccount.address} size={40} />
          <div className="flex-1 min-w-0 text-left">
            <p className="font-display font-medium text-base truncate">
              {activeAccount.name}
            </p>
            <p className="font-mono text-xs text-ink-400 truncate">
              {activeAccount.address.slice(0, 10)}…
              {activeAccount.address.slice(-6)}
            </p>
          </div>
          {/* Always show the chevron — the sheet is always useful, even
              for fresh single-account users (they reach 'Add multisig'
              from inside it). */}
          <ChevronDown size={18} className="text-ink-400 flex-shrink-0" />
        </button>

        {/* Balance hero */}
        <div className="relative overflow-hidden rounded-3xl border border-ink-800 bg-ink-900 grain">
          <div className="absolute inset-0 bg-mesh opacity-40 pointer-events-none" />
          <div className="relative p-6 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
                Transferable
              </span>
              {isLoading && !balance && (
                <span className="text-xs text-ink-400 animate-pulse-subtle">
                  Loading…
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              {hideBalances ? (
                <span className="text-balance-xl text-ink-100">••••••</span>
              ) : (
                <>
                  <span className="text-balance-xl text-ink-100 numeric">
                    {hero.integer}
                  </span>
                  <span className="text-2xl text-ink-400 numeric font-display font-medium">
                    .{hero.fraction}
                  </span>
                </>
              )}
              <span className="text-sm text-ink-300 font-display font-medium ml-1">
                {XX_SYMBOL}
              </span>
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-ink-800/80">
              <BalanceRow
                label="Reserved"
                value={balance?.reserved}
                hidden={hideBalances}
              />
              <BalanceRow
                label="Frozen"
                value={balance?.frozen}
                hidden={hideBalances}
              />
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link to="/send" className="btn-primary">
            <ArrowUpRight size={18} strokeWidth={2} />
            Send
          </Link>
          <Link to="/receive" className="btn-secondary">
            <ArrowDownLeft size={18} strokeWidth={2} />
            Receive
          </Link>
        </div>

        {/* Address card */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Your address
            </span>
            <AddressChip address={activeAccount.address} shortened className="flex-shrink-0" />
          </div>
          <p className="font-mono text-xs text-ink-300 break-all leading-relaxed select-all">
            {activeAccount.address}
          </p>
        </div>

        {/* Transaction history */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-medium text-sm text-ink-200">
              Recent activity
              {txTotal > 0 && (
                <span className="ml-2 text-xs text-ink-400 font-sans font-normal">
                  ({txTotal.toLocaleString()} total)
                </span>
              )}
            </h3>
            {txLoading && (
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </div>
            )}
          </div>

          {txError &&
            (isIndexerDisabledError(txError) ? (
              <p className="text-xs text-ink-400 py-2">
                Transaction history is off — you disabled the indexer in
                Settings → Privacy. Your balance and sending are
                unaffected.
              </p>
            ) : (
              <p className="text-xs text-danger py-2">
                Could not load history — check your connection.
              </p>
            ))}

          {transfers.length === 0 && !txLoading && !txError && (
            <p className="text-sm text-ink-400 py-2">
              No recent transactions found.
            </p>
          )}

          {transfers.length === 0 && txLoading && (
            <div className="space-y-3 py-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-ink-700/50 animate-pulse-subtle" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-2/3" />
                    <div className="h-2.5 rounded bg-ink-700/30 animate-pulse-subtle w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {transfers.map((tx) => (
            <TransactionItem
              key={tx.id}
              transfer={tx}
            />
          ))}
        </div>
      </div>

      {/* Account / multisig switcher sheet */}
      <Sheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        title="Accounts"
      >
        <div className="space-y-5">
          {/* Pending actions — surfaced FIRST when non-empty because anything
              needing the user's attention is more urgent than account switching */}
          {pendingProposals.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-amber-400 font-medium px-1">
                Pending actions ({pendingProposals.length})
              </p>
              <ul className="space-y-2">
                {pendingProposals.map((p) => {
                  const m = multisigs.find((x) => x.address === p.multisigAddress);
                  if (!m) return null;
                  const userIsSigner = m.signers.some(
                    (s) => s.address === activeAccount.address
                  );
                  const userHasApproved = p.approvals.includes(
                    activeAccount.address
                  );
                  const userIsDepositor = p.depositor === activeAccount.address;
                  const needsUser =
                    userIsSigner && !userHasApproved && !userIsDepositor;
                  const stale = stalenessOf(p.whenBlock);
                  // Stale items get the amber highlight regardless of role
                  // (they need attention either way — depositor to cancel,
                  // others to nudge the depositor).
                  const highlight = stale.isStale || needsUser;
                  return (
                    <li key={`${p.multisigAddress}-${p.callHash}`}>
                      <button
                        onClick={() => {
                          navigate(
                            `/multisig/${p.multisigAddress}/approve/${p.callHash}`
                          );
                          setSwitcherOpen(false);
                        }}
                        className={clsx(
                          'w-full flex items-center gap-3 p-3 rounded-2xl border transition-colors text-left',
                          highlight
                            ? 'bg-amber-500/10 border-amber-500/30 active:bg-amber-500/15'
                            : 'bg-ink-800 border-ink-700/50 active:bg-ink-700'
                        )}
                      >
                        <div
                          className={clsx(
                            'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
                            highlight
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-ink-700/50 text-ink-400'
                          )}
                        >
                          <Users size={16} strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {stale.isStale && userIsDepositor
                              ? 'Stale — cancel & reclaim'
                              : stale.isStale
                              ? 'Stale proposal'
                              : needsUser
                              ? 'Awaiting your approval'
                              : userIsDepositor
                              ? 'Your proposal'
                              : 'Awaiting other signers'}
                          </p>
                          <p className="text-xs text-ink-400 truncate">
                            {m.localName} · {p.approvals.length} of{' '}
                            {m.threshold} signed
                            {stale.ageDays > 0 && (
                              <> · {formatAge(stale.ageDays)} old</>
                            )}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Accounts section */}
          <div className="space-y-2">
            {accounts.length > 1 && (
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium px-1">
                Your accounts
              </p>
            )}
            <ul className="space-y-2">
              {accounts.map((acct) => (
                <li key={acct.address}>
                  <AccountSwitcherRow
                    address={acct.address}
                    name={acct.name}
                    isActive={acct.address === activeAccount.address}
                    isLedger={acct.source === 'ledger'}
                    hideBalances={hideBalances}
                    onClick={() => {
                      setActive(acct.address);
                      setSwitcherOpen(false);
                    }}
                    onManage={() => {
                      navigate(`/account/${acct.address}`);
                      setSwitcherOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>

          {/* Multisigs section (only renders when there's at least one) */}
          {multisigs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-ink-400 font-medium px-1">
                Multisigs
              </p>
              <ul className="space-y-2">
                {multisigs.map((m) => {
                  // Pending count for this specific multisig — peeled off
                  // the aggregated list so we don't re-query the chain.
                  const pendingCount = pendingProposals.filter(
                    (p) => p.multisigAddress === m.address
                  ).length;
                  return (
                    <li key={m.address}>
                      <MultisigSwitcherRow
                        address={m.address}
                        localName={m.localName}
                        threshold={m.threshold}
                        signerCount={m.signers.length}
                        pendingCount={pendingCount}
                        hideBalances={hideBalances}
                        isProtected={m.preset === 'two-device'}
                        onClick={() => {
                          navigate(`/multisig/${m.address}`);
                          setSwitcherOpen(false);
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Add affordances — Account and Multisig grouped together as
              the 'create entity' actions in this sheet. */}
          <div className="pt-1 border-t border-ink-800/60 space-y-2">
            <button
              onClick={() => {
                setSwitcherOpen(false);
                setAddAccountChooserOpen(true);
              }}
              className="w-full flex items-center gap-3 p-3 rounded-2xl border border-dashed border-ink-700 active:bg-ink-800 text-ink-300"
            >
              <div className="w-9 h-9 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center">
                <UserPlus size={16} strokeWidth={2} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Add account</p>
                <p className="text-sm text-ink-300 mt-0.5">
                  {accounts.length === 1
                    ? 'Create or import another account'
                    : 'Create or import another account'}
                </p>
              </div>
            </button>
            <button
              onClick={() => {
                setSwitcherOpen(false);
                setAddChooserOpen(true);
              }}
              className="w-full flex items-center gap-3 p-3 rounded-2xl border border-dashed border-ink-700 active:bg-ink-800 text-ink-300"
            >
              <div className="w-9 h-9 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center">
                <Plus size={16} strokeWidth={2} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Add multisig</p>
                <p className="text-sm text-ink-300 mt-0.5">
                  {multisigs.length === 0
                    ? 'Set up a shared multi-signature account'
                    : 'Add another multi-signature account'}
                </p>
              </div>
            </button>
          </div>

          {/* Contacts — surfaces the address book so users can find it
              without diving into Send. Below the Add affordances because
              this is navigational (existing surface) rather than a
              creation action. */}
          <div className="pt-1">
            <button
              onClick={() => {
                setSwitcherOpen(false);
                navigate('/send', { state: { openContacts: true } });
              }}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700"
            >
              <div className="w-9 h-9 rounded-full bg-xx-500/10 text-xx-500 flex items-center justify-center flex-shrink-0">
                <BookUser size={16} strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-display font-medium text-sm text-ink-100">
                  Contacts
                </p>
                <p className="text-xs text-ink-400 mt-0.5">
                  Address book and saved addresses
                </p>
              </div>
              <ChevronRight
                size={16}
                strokeWidth={1.75}
                className="text-ink-400 flex-shrink-0"
              />
            </button>
          </div>
        </div>
      </Sheet>

      {/* Add multisig chooser — manual entry vs JSON import. Each row is
          a self-contained block describing what the option does so the
          user can pick without remembering which is which. */}
      <Sheet
        open={addChooserOpen}
        onClose={() => setAddChooserOpen(false)}
        title="Add multisig"
      >
        <div className="space-y-3">
          {/* Guided "two-device approval" — the recommended, hand-held
              path that builds an opinionated 2-of-3. The manual create /
              import / scan paths sit below for power users. */}
          <button
            onClick={() => {
              setAddChooserOpen(false);
              navigate('/multisig/two-device');
            }}
            className="w-full flex items-start gap-3 p-3 rounded-2xl bg-xx-500/10 border border-xx-500/30 active:bg-xx-500/20 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-ink-900 border border-xx-500/40 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={16} strokeWidth={2} className="text-xx-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink-100">
                  Protect with a second device
                </p>
                <span className="text-xs uppercase tracking-wider text-xx-500 font-semibold">
                  2FA
                </span>
              </div>
              <p className="text-sm text-ink-300 leading-snug mt-0.5">
                Guided setup that requires approval from two of your devices
                before funds can move. Recommended if you want a second factor
                on your savings.
              </p>
            </div>
          </button>

          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium pt-1 px-1">
            Or set up manually
          </p>

          <button
            onClick={() => {
              setAddChooserOpen(false);
              navigate('/multisig/create');
            }}
            className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
              <Plus size={16} strokeWidth={2} className="text-xx-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-100">
                Create new
              </p>
              <p className="text-sm text-ink-300 leading-snug mt-0.5">
                Pick signers from your address book and set the
                threshold. Use this if you're the one organizing the
                multisig — afterward, export the config to share with
                other signers.
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              setAddChooserOpen(false);
              navigate('/multisig/import');
            }}
            className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
              <Download size={16} strokeWidth={2} className="text-xx-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-100">
                Import from JSON
              </p>
              <p className="text-sm text-ink-300 leading-snug mt-0.5">
                Load a config another signer shared with you (file, QR,
                or paste). Your wallet verifies the config integrity
                automatically before importing.
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              setAddChooserOpen(false);
              navigate('/multisig/scan');
            }}
            className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
              <Search size={16} strokeWidth={2} className="text-xx-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-100">
                Scan chain
              </p>
              <p className="text-sm text-ink-300 leading-snug mt-0.5">
                Find multisigs that any of your wallet accounts are
                signers of by walking past on-chain activity. Useful
                if you've used a multisig elsewhere (e.g., the official
                wallet) and want to surface it here.
              </p>
            </div>
          </button>
        </div>
      </Sheet>

      {/* Add account chooser — mirrors Add multisig. Create-new uses
          the Sleeve onboarding flow; Import uses the mnemonic /
          keystore-JSON path. Same routes Settings → Add already uses,
          just reached from the Dashboard dropdown. */}
      <Sheet
        open={addAccountChooserOpen}
        onClose={() => setAddAccountChooserOpen(false)}
        title="Add account"
      >
        <div className="space-y-3">
          <button
            onClick={() => {
              setAddAccountChooserOpen(false);
              navigate('/onboarding/create');
            }}
            className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
              <Plus size={16} strokeWidth={2} className="text-xx-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-100">
                Create new
              </p>
              <p className="text-sm text-ink-300 leading-snug mt-0.5">
                Generate a fresh account with Sleeve quantum-secure
                recovery phrases. Same flow you used for your first
                account.
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              setAddAccountChooserOpen(false);
              navigate('/onboarding/import');
            }}
            className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
              <Download size={16} strokeWidth={2} className="text-xx-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-100">
                Import existing
              </p>
              <p className="text-sm text-ink-300 leading-snug mt-0.5">
                Restore an account from a recovery phrase or a
                wallet.xx.network keystore JSON file.
              </p>
            </div>
          </button>

          {/* Hardware option — only where a transport can actually reach
              a device: WebHID on desktop Chromium, WebUSB (USB-C cable)
              on Android Chrome. Bluetooth deliberately not offered
              (broken upstream for web on Android). iOS and Firefox
              users never see the row rather than hitting a dead end. */}
          {isLedgerSupported() && (
            <button
              onClick={() => {
                setAddAccountChooserOpen(false);
                navigate('/account/ledger/add');
              }}
              className="w-full flex items-start gap-3 p-3 rounded-2xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
            >
              <div className="w-9 h-9 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center flex-shrink-0">
                <Usb size={16} strokeWidth={2} className="text-xx-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-100">
                  Connect Ledger
                </p>
                <p className="text-sm text-ink-300 leading-snug mt-0.5">
                  Add a hardware account. The key stays on the Ledger —
                  every transaction is confirmed on the device.
                </p>
              </div>
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}

function BalanceRow({
  label,
  value,
  hidden,
}: {
  label: string;
  // Mirror whatever formatBalance accepts so a future signature change
  // propagates here without manual upkeep. Currently BN | bigint | string
  // | null | undefined.
  value: Parameters<typeof formatBalance>[0];
  hidden: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
        {label}
      </p>
      <p className="font-mono text-sm text-ink-200">
        {hidden ? '••••' : formatBalance(value, { decimals: 4 })}
      </p>
    </div>
  );
}

/**
 * Single row in the multisig list inside the account switcher. Pulled
 * out into its own component so each row can call useBalance for its
 * own address — the at-a-glance balance is a requirement for the multisig
 * list view (threshold + balance + pending count, all visible without
 * drilling in).
 *
 * Per-row useBalance is acceptable here: foundation users typically
 * have a handful of multisigs (the treasury multisig + a couple of
 * working accounts), and polkadot.js caches system.account queries
 * at the api layer so the cost stays modest. If multisig counts ever
 * grow past ~20 we'd want to switch to a batched query.
 */
/**
 * Single row in the accounts list inside the dashboard switcher.
 * Renders name + truncated address + live balance, mirroring
 * MultisigSwitcherRow so the at-a-glance treatment is symmetric across
 * accounts and multisigs. Respects the hide-balances privacy flag.
 *
 * Per-row useBalance is acceptable: typical wallets have 1-10
 * accounts; polkadot.js caches system.account queries at the api
 * layer so the cost stays modest.
 */
function AccountSwitcherRow({
  address,
  name,
  isActive,
  isLedger,
  hideBalances,
  onClick,
  onManage,
}: {
  address: string;
  name: string;
  isActive: boolean;
  /** Hardware-backed account — shows a small USB glyph beside the name. */
  isLedger: boolean;
  hideBalances: boolean;
  onClick: () => void;
  onManage: () => void;
}) {
  const { balance } = useBalance(address);
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 p-3 rounded-2xl border transition-colors',
        isActive
          ? 'bg-xx-500/10 border-xx-500/40'
          : 'bg-ink-800 border-ink-700/50 active:bg-ink-700'
      )}
    >
      <AddressIcon address={address} size={36} />
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-sm truncate">{name}</p>
          {isLedger && (
            <Usb
              size={12}
              strokeWidth={2.25}
              className="text-xx-500 flex-shrink-0"
              aria-label="Ledger account"
            />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="font-mono text-xs text-ink-400 truncate">
            {address.slice(0, 10)}…
          </p>
          <span className="text-ink-600">·</span>
          <p className="font-mono text-xs text-ink-300 numeric flex-shrink-0">
            {hideBalances
              ? '••••'
              : balance
                ? `${formatBalance(balance.free, { decimals: 4 })} ${XX_SYMBOL}`
                : '—'}
          </p>
        </div>
      </div>
      <span
        role="button"
        tabIndex={0}
        aria-label="Manage account"
        onClick={(e) => {
          e.stopPropagation();
          onManage();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onManage();
          }
        }}
        className="flex-shrink-0 w-8 h-8 rounded-lg bg-ink-900 border border-ink-700 flex items-center justify-center text-ink-300 active:bg-ink-700 active:text-ink-100 cursor-pointer"
      >
        <ChevronRight size={16} strokeWidth={2.25} />
      </span>
    </button>
  );
}

function MultisigSwitcherRow({
  address,
  localName,
  threshold,
  signerCount,
  pendingCount,
  hideBalances,
  isProtected,
  onClick,
}: {
  address: string;
  localName: string;
  threshold: number;
  signerCount: number;
  pendingCount: number;
  hideBalances: boolean;
  /** Two-device-approval protected account — adds a shield glyph to the
   *  threshold pill. The M-of-N stays visible either way. */
  isProtected: boolean;
  onClick: () => void;
}) {
  const { balance } = useBalance(address);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-2xl border bg-ink-800 border-ink-700/50 active:bg-ink-700"
    >
      <AddressIcon address={address} size={36} />
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm truncate">{localName}</p>
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-xx-500/10 text-xx-500 text-xs font-medium flex-shrink-0"
            title={isProtected ? 'Protected account' : undefined}
          >
            {isProtected ? (
              <ShieldCheck size={9} strokeWidth={2.25} />
            ) : (
              <Users size={9} strokeWidth={2.25} />
            )}
            {threshold}-of-{signerCount}
          </span>
          {pendingCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 text-xs font-medium flex-shrink-0"
              title={`${pendingCount} pending proposal${pendingCount === 1 ? '' : 's'}`}
            >
              {pendingCount} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="font-mono text-xs text-ink-300 numeric">
            {hideBalances
              ? '••••'
              : balance
              ? `${formatBalance(balance.free, { decimals: 4 })} ${XX_SYMBOL}`
              : '—'}
          </p>
        </div>
      </div>
    </button>
  );
}
