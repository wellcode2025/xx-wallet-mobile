/**
 * MultisigPropose — first-signature submission of a new multisig action.
 *
 * The depositor's side of the multisig flow. They construct an inner call
 * (currently supports balances.transferKeepAlive only — the foundation's
 * actual usage), wrap it in `multisig.asMulti(..., maybeTimepoint=null,
 * ..., call, weight)`, sign and submit it themselves as the first
 * approval. Other cosigners then approve via the approval flow.
 *
 * After the on-chain submission finalizes, the wallet:
 *   1. Caches the call data locally in PendingProposalCache so the
 *      depositor can re-share it later if cosigners need it again.
 *   2. Navigates to the Share screen where the user picks
 *      how to deliver the call data to cosigners (file / QR / share sheet).
 *
 * Self-contained from Send (no shared form code) so
 * we don't risk regressing the working Send flow.
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  BookUser,
  Check,
  Key,
  Loader2,
  ScanLine,
  ShieldAlert,
  Users,
} from 'lucide-react';
import BigNumber from 'bignumber.js';
import { BN } from '@polkadot/util';
import { TopBar } from '@/components/layout';
import {
  AddressChip,
  AddressIcon,
  AddressLabel,
  QrScanner,
  Sheet,
} from '@/components/ui';
import { useApi, useBalance, useTx } from '@/hooks';
import {
  useAccountsStore,
  useAddressBook,
  useMultisigsStore,
  usePendingBytesStore,
} from '@/store';
import { shortenAddress } from '@/utils';
import { formatBalance, isValidXxAddress, parseAmount } from '@/utils';
import { XX_DECIMALS, XX_SYMBOL } from '@/api';

/**
 * Existential deposit on xx network — same constant the Send screen uses.
 * Multisig accounts are also subject to it; we don't want a propose to
 * leave the multisig itself reaped.
 */
const EXISTENTIAL_DEPOSIT = new BigNumber('1000000');

/**
 * Same generous static weight bound as the approval flow uses (see
 * MultisigApprove notes for the rationale). This could later be computed
 * dynamically from the inner call's paymentInfo.
 */
const STATIC_INNER_CALL_WEIGHT = {
  refTime: 500_000_000,
  proofSize: 10_000,
};

export function MultisigPropose() {
  const { address } = useParams<{ address: string }>();
  const multisig = useMultisigsStore((s) =>
    address ? s.getMultisig(address) : undefined
  );
  if (!address || !multisig) {
    return <Navigate to="/" replace />;
  }
  return <ProposeView address={address} />;
}

function ProposeView({ address }: { address: string }) {
  const navigate = useNavigate();
  const multisig = useMultisigsStore((s) => s.getMultisig(address))!;
  // Accounts from the guided two-device-approval wizard reframe the spend
  // flow as 2-factor ("start a spend → approve on your second device").
  // Cosmetic only; the signing path below is identical.
  const isTwoDevice = multisig.preset === 'two-device';
  const { accounts, activeAddress } = useAccountsStore();
  const { balance } = useBalance(address);
  const putBytes = usePendingBytesStore((s) => s.putBytes);
  const api = useApi();
  const {
    submit,
    status: txStatus,
    error: txError,
    txHash,
    reset: resetTx,
  } = useTx();

  // Compute which of the user's wallet accounts are signers of this
  // multisig. ANY of these can be the on-chain signatory for a propose.
  // Show an explicit signer picker; never sign silently as the active
  // account — surface the choice rather than use `activeAddress` implicitly.
  const eligibleSigners = useMemo(
    () =>
      accounts.filter((a) =>
        multisig.signers.some((s) => s.address === a.address)
      ),
    [accounts, multisig.signers]
  );

  // Default the picker to the active account if it's eligible, otherwise
  // the first eligible signer (most users have only one anyway).
  const [signerAddress, setSignerAddress] = useState<string>(() => {
    if (
      activeAddress &&
      eligibleSigners.some((a) => a.address === activeAddress)
    ) {
      return activeAddress;
    }
    return eligibleSigners[0]?.address ?? '';
  });

  // If the eligible-signers list changes (e.g., user adds a new account
  // mid-flow), keep the picker pointed at something valid.
  useEffect(() => {
    if (
      signerAddress &&
      eligibleSigners.some((a) => a.address === signerAddress)
    ) {
      return;
    }
    if (eligibleSigners.length > 0) {
      setSignerAddress(eligibleSigners[0].address);
    } else {
      setSignerAddress('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleSigners.map((a) => a.address).join('|')]);

  const signerAccount = accounts.find((a) => a.address === signerAddress);
  const hasEligibleSigner = eligibleSigners.length > 0;

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  // Address-book picker + QR scanner state — mirrors the Send screen's
  // affordances so the user can pick a recipient by name or by camera
  // without leaving the propose flow.
  const { contacts } = useAddressBook();
  const [contactsOpen, setContactsOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        (c.note ?? '').toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Cache the call hash + bytes at submit time so we can route to the
  // share screen with them in hand. Computed once at builder construction.
  const [submittedCallHash, setSubmittedCallHash] = useState<string | null>(
    null
  );

  const recipientValid = isValidXxAddress(recipient.trim());

  // Sending FROM the multisig TO itself is a chain-level no-op (same as
  // for regular accounts); block it in the UI rather than discover the
  // problem after a fee burn.
  const recipientIsMultisig =
    recipient.trim() === address && recipient.trim().length > 0;

  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);

  const transferable = useMemo(
    () => (balance ? new BigNumber(balance.transferable.toString()) : null),
    [balance]
  );

  // Existential deposit warnings — same logic as Send. The multisig is
  // the sender here; if the proposed amount would reap it, the chain
  // will refuse via transferKeepAlive at execution time unless the user
  // explicitly opts into reaping (which switches the inner call to
  // transferAllowDeath). Catches both "leaves a tiny non-zero remainder"
  // and "exactly drains" cases — both end up below ED post-fee.
  const senderBelowED = useMemo(() => {
    if (!parsedAmount || !transferable) return false;
    const remaining = transferable.minus(parsedAmount);
    return remaining.isLessThan(EXISTENTIAL_DEPOSIT);
  }, [parsedAmount, transferable]);

  // Conscious-acknowledge: user understands that reaping the multisig
  // will remove its on-chain record (and any reserved deposits from
  // pending proposals at this multisig). Resets when amount/recipient
  // changes so each edit re-confirms.
  const [allowReaping, setAllowReaping] = useState(false);
  useEffect(() => {
    setAllowReaping(false);
  }, [amount, recipient]);

  const recipientBelowED = useMemo(() => {
    if (!parsedAmount) return false;
    return parsedAmount.isLessThan(EXISTENTIAL_DEPOSIT);
  }, [parsedAmount]);

  const amountValid =
    parsedAmount !== null &&
    parsedAmount.isGreaterThan(0) &&
    transferable !== null &&
    parsedAmount.isLessThanOrEqualTo(transferable);

  // Pre-flight cost check: the PROPOSER pays the network fee AND reserves a
  // multisig deposit, both from its own account (not the multisig's). Estimate
  // the total so we can block before signing instead of failing mid-broadcast.
  const { balance: signerBalance } = useBalance(signerAddress);
  const [estCost, setEstCost] = useState<BN | null>(null);
  useEffect(() => {
    if (!api || !signerAddress || !recipientValid || !parsedAmount) {
      setEstCost(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dest = recipient.trim();
        const value = parsedAmount.toFixed(0);
        const innerExt = allowReaping
          ? (api.tx.balances.transferAllowDeath ?? api.tx.balances.transfer)(
              dest,
              value
            )
          : api.tx.balances.transferKeepAlive(dest, value);
        const innerCall = innerExt.method;
        const otherSignatories = multisig.signers
          .map((s) => s.address)
          .filter((a) => a !== signerAddress)
          .sort();
        const tx =
          multisig.threshold === 1
            ? api.tx.multisig.asMultiThreshold1(otherSignatories, innerCall)
            : api.tx.multisig.asMulti(
                multisig.threshold,
                otherSignatories,
                null,
                innerCall,
                STATIC_INNER_CALL_WEIGHT
              );
        const info = await tx.paymentInfo(signerAddress);
        let cost = info.partialFee.toBn();
        // Proposing a new (threshold ≥ 2) multisig op reserves a deposit from
        // the proposer: DepositBase + DepositFactor * signatories.
        if (multisig.threshold >= 2) {
          try {
            const base = new BN(api.consts.multisig.depositBase.toString());
            const factor = new BN(api.consts.multisig.depositFactor.toString());
            cost = cost.add(base.add(factor.muln(multisig.signers.length)));
          } catch {
            /* consts unavailable — fall back to a fee-only estimate */
          }
        }
        if (!cancelled) setEstCost(cost);
      } catch {
        if (!cancelled) setEstCost(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    signerAddress,
    recipient,
    recipientValid,
    parsedAmount,
    allowReaping,
    multisig.threshold,
  ]);

  // Only a hard shortfall blocks — estCost null (still estimating) never blocks.
  const feeShortfall = !!(
    signerBalance &&
    estCost &&
    signerBalance.transferable.lt(estCost)
  );

  const canContinue =
    recipientValid &&
    !recipientIsMultisig &&
    amountValid &&
    hasEligibleSigner &&
    !!signerAddress &&
    !feeShortfall &&
    (!senderBelowED || allowReaping);

  const isSubmitting =
    txStatus === 'signing' ||
    txStatus === 'broadcasting' ||
    txStatus === 'in-block';
  const isDone = txStatus === 'finalized';

  // Threshold=1 multisigs execute immediately on a single signature
  // (chain uses `as_multi_threshold_1` instead of the propose/approve
  // cycle). The UX has to reflect this — calling it a "proposal" would
  // mislead users about what's actually happening.
  const isImmediate = multisig.threshold === 1;

  const submitLabel = (() => {
    switch (txStatus) {
      case 'signing':
        return 'Signing…';
      case 'broadcasting':
        return 'Sending to network…';
      case 'in-block':
        return 'Waiting for finality…';
      case 'finalized':
        return 'Done';
      default:
        return isImmediate
          ? 'Confirm and execute'
          : isTwoDevice
            ? 'Propose spend'
            : 'Propose to cosigners';
    }
  })();

  const setMax = () => {
    if (!transferable) return;
    const safeMax = transferable.minus(EXISTENTIAL_DEPOSIT);
    if (safeMax.isLessThanOrEqualTo(0)) return;
    const human = safeMax
      .div(new BigNumber(10).pow(XX_DECIMALS))
      .toFixed(XX_DECIMALS)
      .replace(/\.?0+$/, '');
    setAmount(human);
  };

  const handleOpenConfirm = () => {
    resetTx();
    setPasswordError(null);
    setSubmittedCallHash(null);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!signerAddress || !parsedAmount || !api) return;
    setPasswordError(null);
    try {
      await submit(
        (api) => {
          // Build the inner call we want the multisig to execute. The
          // exact extrinsic depends on whether the user has consciously
          // opted into reaping the multisig:
          //   - default → transferKeepAlive (chain refuses if it would
          //     leave the multisig below the existential deposit)
          //   - allowReaping ack'd → allow-death variant (chain permits
          //     it, multisig account record gets removed afterward)
          //
          // Runtime fallback: newer Substrate runtimes expose this as
          // `transferAllowDeath`; older ones (xx network as of 2026-05)
          // keep the legacy name `transfer` with identical semantics.
          // Prefer the new name; fall back to the old.
          const dest = recipient.trim();
          const value = parsedAmount.toFixed(0);
          let innerExt;
          if (allowReaping) {
            const allowDeath =
              api.tx.balances.transferAllowDeath ??
              api.tx.balances.transfer;
            if (!allowDeath) {
              throw new Error(
                'This chain exposes neither balances.transferAllowDeath ' +
                  'nor balances.transfer — cannot drain the multisig.'
              );
            }
            innerExt = allowDeath(dest, value);
          } else {
            innerExt = api.tx.balances.transferKeepAlive(dest, value);
          }
          const innerCall = innerExt.method;
          const callBytesHex = innerCall.toHex();
          const callHash = innerCall.hash.toHex();

          // Cache bytes locally BEFORE submission so the share screen
          // has them even if the user navigates away mid-broadcast and
          // comes back. The cache write is idempotent — putting the same
          // hash twice is fine. (For threshold=1 we cache anyway, in
          // case the user wants the JSON for record-keeping; the call
          // executes immediately so there's no pending entry to share
          // with cosigners.)
          putBytes({
            multisigAddress: address,
            callHash,
            callBytes: callBytesHex,
            source: 'self-proposed',
            receivedAt: Date.now(),
          });
          setSubmittedCallHash(callHash);

          // Other signatories: every signer EXCEPT the chosen signatory,
          // sorted SS58. We exclude based on the user-picked signer
          // (NOT activeAddress), per the multisig signer-picker rule.
          const otherSignatories = multisig.signers
            .map((s) => s.address)
            .filter((a) => a !== signerAddress)
            .sort();

          // Pick the right extrinsic based on threshold:
          //   - threshold = 1 → as_multi_threshold_1 (executes immediately,
          //     no propose/approve cycle; chain refuses as_multi here with
          //     "MinimumThreshold: Threshold must be 2 or greater").
          //   - threshold ≥ 2 → as_multi as the first signature, with
          //     maybeTimepoint=null. Subsequent approvers fill in the
          //     timepoint from chain state.
          if (multisig.threshold === 1) {
            return api.tx.multisig.asMultiThreshold1(
              otherSignatories,
              innerCall
            );
          }
          return api.tx.multisig.asMulti(
            multisig.threshold,
            otherSignatories,
            null,
            innerCall,
            STATIC_INNER_CALL_WEIGHT
          );
        },
        { address: signerAddress, password }
      );
      // On finalized, isDone flips and the success sheet renders. The
      // user dismisses it which navigates to the share screen.
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('unable to decode') ||
        msg.toLowerCase().includes('incorrect')
      ) {
        setPasswordError('Incorrect password. Please try again.');
      }
    }
  };

  const closeConfirm = () => {
    if (isSubmitting) return;
    setConfirmOpen(false);
    setPassword('');
    setPasswordError(null);
    resetTx();
  };

  const closeSuccess = () => {
    resetTx();
    setConfirmOpen(false);
    // For threshold=1, the call executed immediately — there are no
    // cosigners to share with, so skip the share screen and just go
    // back to the multisig detail (where the user will see the
    // resulting transfer in the activity timeline once the indexer
    // catches up).
    if (isImmediate) {
      navigate(`/multisig/${address}`, { replace: true });
      return;
    }
    if (submittedCallHash) {
      navigate(`/multisig/${address}/share/${submittedCallHash}`, {
        replace: true,
      });
    } else {
      navigate(`/multisig/${address}`, { replace: true });
    }
  };

  if (!hasEligibleSigner) {
    return (
      <>
        <TopBar title="Propose" showBack />
        <div className="px-5 py-6 max-w-md mx-auto">
          <div className="card text-center space-y-2">
            <AlertTriangle
              size={32}
              className="text-amber-400 mx-auto"
              strokeWidth={1.5}
            />
            <p className="text-sm text-ink-200">
              None of the accounts in your wallet are signers of this
              multisig.
            </p>
            <p className="text-xs text-ink-400 leading-relaxed">
              To propose at it, import or create one of its signer
              accounts in this wallet first.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title={isTwoDevice ? 'Start a spend' : 'Propose'} showBack />
      <div className="px-5 py-4 space-y-5 max-w-md mx-auto pb-24">
        {/* Multisig context header — funds origin */}
        <div className="card space-y-1">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-xx-500" strokeWidth={2.25} />
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              {isTwoDevice ? 'Funds from protected account' : 'Funds from multisig'}
            </p>
          </div>
          <p className="text-sm font-medium text-ink-100">
            {multisig.localName}
          </p>
          <p className="font-mono text-xs text-ink-400 truncate">
            {address}
          </p>
          <p className="text-xs text-ink-400">
            Balance:{' '}
            {balance ? formatBalance(balance.transferable) : '—'} {XX_SYMBOL} ·
            Threshold: {multisig.threshold}-of-{multisig.signers.length}
          </p>
        </div>

        {/* Signed by — which of YOUR signer accounts will be the actual
            on-chain signatory for this proposal. The fee comes from this
            account; the proposal lists this account as the depositor. */}
        <div className="card space-y-2">
          <div className="flex items-center gap-2">
            <Key size={14} className="text-xx-500" strokeWidth={2.25} />
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
              Signed by
            </p>
          </div>
          {eligibleSigners.length === 1 ? (
            // Single eligible signer — show as fixed display, no picker.
            // We still surface the account explicitly so the user knows
            // which key is signing and which account pays the fee.
            <div className="flex items-center gap-2">
              <AddressIcon
                address={eligibleSigners[0].address}
                size={28}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-100 truncate">
                  {eligibleSigners[0].name}
                </p>
                <p className="font-mono text-xs text-ink-400 truncate">
                  {eligibleSigners[0].address}
                </p>
              </div>
            </div>
          ) : (
            // Multiple eligible signers — let the user pick which one signs.
            <select
              value={signerAddress}
              onChange={(e) => setSignerAddress(e.target.value)}
              className="input-base text-sm"
            >
              {eligibleSigners.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name} — {a.address.slice(0, 8)}…{a.address.slice(-6)}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-400 leading-relaxed">
              Signs the proposal and pays the network fee from its own
              balance. The funds themselves still come from the multisig
              above.
            </p>
            {signerBalance && (
              <p
                className={`text-xs font-mono numeric flex-shrink-0 ${
                  feeShortfall ? 'text-danger' : 'text-ink-300'
                }`}
              >
                {formatBalance(signerBalance.transferable, { decimals: 4 })} XX
              </p>
            )}
          </div>
          {feeShortfall && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-danger/10 border border-danger/30">
              <AlertTriangle
                size={14}
                className="text-danger flex-shrink-0 mt-0.5"
              />
              <p className="text-xs text-ink-200 leading-snug">
                This account can't cover the cost of proposing
                {estCost ? (
                  <> (≈{formatBalance(estCost, { decimals: 4 })} XX)</>
                ) : null}
                . Add a little XX to it first — signer accounts pay the network
                fee and the multisig deposit from their own balance. Tip: keep
                ≈5 XX in each signer for fees.
              </p>
            </div>
          )}
        </div>

        {/* Recipient — mirrors Send's affordance row so the user can pick
            a contact or scan a QR without leaving the propose flow */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-ink-300 uppercase tracking-wide">
              Recipient address
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setContactsOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-ink-300 active:text-ink-100"
              >
                <BookUser size={14} />
                {contacts.length > 0
                  ? `Contacts (${contacts.length})`
                  : 'Contacts'}
              </button>
              <button
                onClick={() => setScannerOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-xx-500 active:text-xx-600"
              >
                <ScanLine size={14} />
                Scan QR
              </button>
            </div>
          </div>
          <textarea
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="input-base min-h-[88px] py-3 font-mono text-sm resize-none"
            placeholder="6… or pick a contact / scan a QR"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {recipient && !recipientValid && (
            <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
              <AlertTriangle size={12} />
              Not a valid xx network address
            </p>
          )}
          {recipientValid && recipientIsMultisig && (
            <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
              <AlertTriangle size={12} />
              That's this multisig's own address. Pick a different recipient.
            </p>
          )}
          {recipientValid && !recipientIsMultisig && (
            <p className="text-xs text-xx-500 mt-1.5 flex items-center gap-1">
              <Check size={12} />
              Valid xx address
            </p>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className="flex justify-between items-baseline mb-1.5">
            <label className="text-xs font-medium text-ink-300 uppercase tracking-wide">
              Amount
            </label>
            {balance && (
              <button
                onClick={setMax}
                className="text-xs font-medium text-xx-500 active:text-xx-600"
              >
                Max: {formatBalance(balance.transferable, { decimals: 4 })}
              </button>
            )}
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                const cleaned =
                  parts.length > 2
                    ? `${parts[0]}.${parts.slice(1).join('')}`
                    : v;
                setAmount(cleaned);
              }}
              className="input-base pr-16 text-xl font-mono"
              placeholder="0.0"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-300 font-display font-medium">
              {XX_SYMBOL}
            </span>
          </div>
          {amount && parsedAmount === null && (
            <p className="text-xs text-danger mt-1.5">
              Invalid amount — enter a number like 1.5
            </p>
          )}
          {amount &&
            parsedAmount !== null &&
            transferable &&
            parsedAmount.isGreaterThan(transferable) && (
              <p className="text-xs text-danger mt-1.5">
                Amount exceeds the multisig's transferable balance
              </p>
            )}
          {senderBelowED && (
            <div className="flex flex-col gap-2 mt-2 p-3 rounded-xl bg-warning/10 border border-warning/30">
              <div className="flex items-start gap-2">
                <ShieldAlert
                  size={14}
                  className="text-warning flex-shrink-0 mt-0.5"
                />
                <p className="text-xs text-ink-200 leading-relaxed">
                  This will leave the multisig below the existential
                  deposit (0.001 XX) and the chain will remove its
                  account record.
                </p>
              </div>
              <div className="text-xs text-ink-300 leading-relaxed pl-6 space-y-1">
                <p>What that means for this multisig:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-ink-400">
                  <li>
                    The multisig
                    <span className="text-ink-200"> address itself</span>
                    {' '}is unchanged. Anyone — including a cosigner —
                    can fund it again later, and the same threshold +
                    signers will still derive to it.
                  </li>
                  <li>
                    Any
                    <span className="text-ink-200"> reserved deposits</span>
                    {' '}from currently-pending proposals at this
                    multisig will be wiped along with the account record.
                    If you have pending proposals here, cancel them
                    first to reclaim the deposits before reaping.
                  </li>
                  <li>
                    The multisig's nonce resets to 0 (rarely
                    consequential).
                  </li>
                </ul>
              </div>
              <label className="flex items-start gap-2 mt-1 text-xs text-ink-200 leading-snug cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allowReaping}
                  onChange={(e) => setAllowReaping(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 accent-warning flex-shrink-0"
                />
                <span>
                  I understand and want to proceed.
                </span>
              </label>
            </div>
          )}
          {recipientBelowED && recipientValid && !senderBelowED && (
            <div className="flex items-start gap-2 mt-2 p-3 rounded-xl bg-warning/10 border border-warning/30">
              <ShieldAlert
                size={14}
                className="text-warning flex-shrink-0 mt-0.5"
              />
              <p className="text-xs text-ink-200 leading-relaxed">
                Sending less than 0.001 XX to a new account may mean it
                never appears on chain. Confirm the recipient already has
                a balance.
              </p>
            </div>
          )}
        </div>

        {/* What happens next — set expectations before submit. The
            content depends on threshold: at 1, a single signature
            executes immediately; at ≥2, this is the first of N
            signatures and the rest must approve before execution. */}
        <div className="card text-xs text-ink-400 leading-relaxed space-y-1">
          {isImmediate ? (
            <>
              <p className="text-ink-300">When you tap Execute:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  The transfer is signed and submitted on chain.
                </li>
                <li>
                  Because this multisig has threshold 1, your single
                  signature executes the call immediately — no cosigner
                  approvals needed.
                </li>
                <li>
                  The funds move out of the multisig as soon as the
                  block finalizes.
                </li>
              </ul>
            </>
          ) : isTwoDevice ? (
            <>
              <p className="text-ink-300">When you tap Propose:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Your first approval is submitted on chain.</li>
                <li>
                  You'll get a QR code (or file) to open on your second
                  device.
                </li>
                <li>
                  Approving there releases the funds; until then they stay
                  in your protected account.
                </li>
              </ul>
            </>
          ) : (
            <>
              <p className="text-ink-300">When you tap Propose:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  The proposal is submitted on chain as the first
                  signature.
                </li>
                <li>
                  You'll be taken to a share screen to send the call
                  data to the other {multisig.signers.length - 1} signer
                  {multisig.signers.length - 1 !== 1 ? 's' : ''}.
                </li>
                <li>
                  {multisig.threshold - 1} more approval
                  {multisig.threshold - 1 !== 1 ? 's' : ''} will execute
                  the transfer; until then the funds stay in the
                  multisig.
                </li>
              </ul>
            </>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleOpenConfirm}
          disabled={!canContinue}
          className="btn-primary w-full"
        >
          <ArrowUpRight size={18} />
          {isImmediate ? 'Execute' : isTwoDevice ? 'Start spend' : 'Propose'}
        </button>
      </div>

      {/* QR scanner — full-screen takeover. Same pattern as the Send
          screen so the camera-permission UX is consistent. */}
      {scannerOpen && (
        <QrScanner
          onScan={(result) => {
            setRecipient(result);
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Contacts picker — lightweight list-only sheet (no add/edit/delete).
          The full management flow lives on the Send screen; here we just
          let the user pick a recipient by name without leaving the
          propose flow. If contact-management-from-propose ever becomes
          a real ask, refactor toward sharing ContactsSheet. */}
      <Sheet
        open={contactsOpen}
        onClose={() => {
          setContactsOpen(false);
          setContactSearch('');
        }}
        title={`Pick a contact (${contacts.length})`}
      >
        <div className="space-y-3">
          {contacts.length === 0 ? (
            <div className="card text-center text-sm text-ink-400">
              No contacts yet. Add some from the Send screen.
            </div>
          ) : (
            <>
              {contacts.length > 5 && (
                <input
                  type="search"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="input-base text-sm"
                  placeholder="Search by name, address, or note"
                />
              )}
              <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                {filteredContacts.length === 0 && (
                  <li className="text-xs text-ink-400 text-center py-4">
                    No contacts match "{contactSearch}".
                  </li>
                )}
                {filteredContacts.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setRecipient(c.address);
                        setContactsOpen(false);
                        setContactSearch('');
                      }}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-ink-800 border border-ink-700/50 active:bg-ink-700 text-left"
                    >
                      <AddressIcon address={c.address} size={32} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-100 truncate">
                          {c.name || '(unnamed contact)'}
                        </p>
                        <p className="font-mono text-xs text-ink-400 truncate">
                          {shortenAddress(c.address, { start: 8, end: 6 })}
                        </p>
                        {c.note && (
                          <p className="text-xs text-ink-400 truncate">
                            {c.note}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Sheet>

      {/* Confirmation sheet — captures password and submits asMulti
          (or asMultiThreshold1 for threshold=1 multisigs). */}
      <Sheet
        open={confirmOpen && !isDone}
        onClose={closeConfirm}
        title={
          isImmediate
            ? 'Confirm and execute'
            : isTwoDevice
              ? 'Confirm spend'
              : 'Confirm proposal'
        }
      >
        <div className="space-y-4">
          <div className="space-y-3 p-4 rounded-2xl bg-ink-800 border border-ink-700/50">
            <Row label="Funds from">
              <span className="font-medium text-sm">{multisig.localName}</span>
            </Row>
            <Row label="Signed by">
              <span className="font-medium text-sm">
                {signerAccount?.name ?? 'unknown'}
              </span>
            </Row>
            <Row label="To">
              <AddressLabel
                address={recipient.trim()}
                stacked
                className="text-sm items-end"
              />
            </Row>
            <Row label="Amount">
              <span className="font-mono text-base text-ink-100">
                {amount} {XX_SYMBOL}
              </span>
            </Row>
            <Row label="Effect">
              <span className="text-xs text-ink-300 leading-snug">
                {isImmediate
                  ? 'Threshold 1 — your single signature executes the transfer immediately on chain.'
                  : isTwoDevice
                    ? 'Records your first approval. Your second device must approve before the funds move.'
                    : 'Records your signature as the proposer. Other signers must approve before the transfer executes.'}
              </span>
            </Row>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-300 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              className="input-base"
              placeholder="Enter your wallet password to sign"
              autoComplete="current-password"
              disabled={isSubmitting}
            />
            {passwordError && (
              <p className="text-xs text-danger mt-1.5 flex items-center gap-1">
                <AlertTriangle size={12} />
                {passwordError}
              </p>
            )}
          </div>

          {txError && !passwordError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-ink-200">
              <AlertTriangle
                size={16}
                className="text-danger flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="font-medium mb-0.5">Proposal failed</p>
                <p className="text-xs text-ink-300 break-all">
                  {txError.message}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !password}
            className="btn-primary w-full"
          >
            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </Sheet>

      {/* Success sheet — for threshold ≥ 2 it leads to the share screen;
          for threshold = 1 it goes straight back to the multisig detail
          (no cosigners to share with). */}
      <Sheet open={isDone} onClose={closeSuccess}>
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-xx-500/10 border border-xx-500/40 flex items-center justify-center">
            <Check size={32} className="text-xx-500" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-xl">
              {isImmediate
                ? 'Transfer executed'
                : isTwoDevice
                  ? 'Spend started'
                  : 'Proposal submitted'}
            </h2>
            <p className="text-sm text-ink-400 mt-1 leading-relaxed">
              {isImmediate
                ? 'The transfer has executed on chain. The funds have moved out of the multisig.'
                : isTwoDevice
                  ? 'Your first approval is on chain. Next: open this on your second device to approve and release the funds.'
                  : 'Your signature is on chain. Next: share the call data with your cosigners so they can approve.'}
            </p>
          </div>
          {txHash && (
            <div className="w-full">
              <p className="text-xs text-ink-400 mb-1 uppercase tracking-wide">
                Transaction hash
              </p>
              <AddressChip address={txHash} shortened className="w-full" />
            </div>
          )}
          <button onClick={closeSuccess} className="btn-primary w-full mt-2">
            {isImmediate
              ? 'Done'
              : isTwoDevice
                ? 'Send to second device'
                : 'Share with cosigners'}
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-ink-400 uppercase tracking-wide flex-shrink-0 pt-0.5">
        {label}
      </span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
