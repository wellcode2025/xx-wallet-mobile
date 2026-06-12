/**
 * useTx — submit a signed transaction and track its status.
 *
 * Usage:
 *   const { submit, status, txHash, error } = useTx();
 *   await submit(
 *     (api) => api.tx.balances.transferKeepAlive(recipient, amount),
 *     { address: fromAddress, password }
 *   );
 */
import { useState, useCallback } from 'react';
import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { xxApi } from '../api';
import { isLedgerAccount, xxKeyring } from '../keyring';

export type TxStatus =
  | 'idle'
  | 'signing'
  | 'broadcasting'
  | 'in-block'
  | 'finalized'
  | 'error';

export interface SubmitOptions {
  address: string;
  /**
   * Required for local (keystore) accounts; ignored for Ledger accounts,
   * where "signing" means confirming on the device instead. Callers that
   * can sign from a Ledger account should render a confirm-on-device
   * hint while status is 'signing' (see isLedgerAddress helper).
   */
  password?: string;
}

/**
 * Whether an address belongs to a Ledger-backed account in this wallet.
 * Screens use this to swap the password input for a "confirm on your
 * Ledger" prompt and to gate call types the Ledger app can't sign
 * (multisig, democracy, batched staking).
 */
export function isLedgerAddress(address: string): boolean {
  const account = xxKeyring.listAccounts().find((a) => a.address === address);
  return !!account && isLedgerAccount(account);
}

type TxBuilder = (api: ApiPromise) => SubmittableExtrinsic<'promise'>;

export function useTx() {
  const [status, setStatus] = useState<TxStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [blockHash, setBlockHash] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setBlockHash(null);
    setError(null);
  }, []);

  const submit = useCallback(
    async (builder: TxBuilder, opts: SubmitOptions): Promise<string> => {
      reset();
      let pair: KeyringPair | null = null;
      try {
        setStatus('signing');

        const api = await xxApi.getApi();
        const extrinsic = builder(api);

        // Shared status tracker for both signing paths. The promise
        // settles on finality or any failure mode.
        const track = (
          resolve: (hash: string) => void,
          reject: (err: Error) => void
        ) => ({ status: s, txHash: hash, dispatchError }: ISubmittableResult) => {
          setTxHash(hash.toHex());
          if (s.isReady || s.isBroadcast) {
            // First sign-of-life after the signature exists — relevant
            // mostly for the Ledger path, where everything before this
            // was the user reading the device screen.
            setStatus('broadcasting');
          }
          if (s.isInBlock) {
            setStatus('in-block');
            setBlockHash(s.asInBlock.toHex());
          } else if (s.isFinalized) {
            setStatus('finalized');
            setBlockHash(s.asFinalized.toHex());
            resolve(hash.toHex());
          } else if (s.isInvalid || s.isDropped || s.isUsurped) {
            const msg = `Transaction ${s.type.toLowerCase()}`;
            setError(new Error(msg));
            setStatus('error');
            reject(new Error(msg));
          }
          if (dispatchError) {
            let msg = 'Transaction failed';
            if (dispatchError.isModule) {
              try {
                const decoded = api.registry.findMetaError(
                  dispatchError.asModule
                );
                msg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
              } catch {
                /* ignore */
              }
            } else {
              msg = dispatchError.toString();
            }
            setError(new Error(msg));
            setStatus('error');
            reject(new Error(msg));
          }
        };

        // --- Ledger branch: external signer, no keystore, no password.
        // Status stays 'signing' while the user reads + confirms on the
        // device; the tracker flips it to 'broadcasting' on first chain
        // callback. A device rejection surfaces as a mapped error.
        const account = xxKeyring
          .listAccounts()
          .find((a) => a.address === opts.address);
        if (account && isLedgerAccount(account)) {
          const { LedgerSigner } = await import('../ledger');
          const signer = new LedgerSigner(api.registry, account.ledger);
          return await new Promise<string>((resolve, reject) => {
            extrinsic
              .signAndSend(opts.address, { signer }, track(resolve, reject))
              .catch((err) => {
                setError(err as Error);
                setStatus('error');
                reject(err as Error);
              });
          });
        }

        // --- Local branch: decrypt-then-sign, unchanged behavior.
        if (typeof opts.password !== 'string') {
          throw new Error('Password required to sign from this account.');
        }
        // unlock() is async because wallet.xx.network JSON uses scrypt N=131072
        // which requires an awaited key derivation step.
        pair = await xxKeyring.unlock(opts.address, opts.password);

        setStatus('broadcasting');
        return await new Promise<string>((resolve, reject) => {
          extrinsic
            .signAndSend(pair!, track(resolve, reject))
            .catch((err) => {
              setError(err as Error);
              setStatus('error');
              reject(err);
            });
        });
      } catch (err) {
        setError(err as Error);
        setStatus('error');
        throw err;
      } finally {
        // Lock the pair (re-encrypts the secret in @polkadot/keyring's
        // internal storage) AND evict it from the keyring's in-memory map.
        // Both must run; we use independent try/catch so a failure in one
        // doesn't skip the other.
        if (pair) {
          if (typeof pair.lock === 'function') {
            try { pair.lock(); } catch { /* swallow */ }
          } else {
            // Should not happen with current @polkadot/keyring versions —
            // if it does, the pair is sitting in memory unlocked and we
            // want to know about it. Don't throw (we're in a finally
            // block) but make the regression visible in the console.
            console.error(
              'KeyringPair has no lock() method — possible @polkadot/keyring API change'
            );
          }
          xxKeyring.removeFromKeyring(pair.address);
        }
      }
    },
    [reset]
  );

  return { submit, reset, status, txHash, blockHash, error };
}
