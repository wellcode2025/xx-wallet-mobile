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
import type { KeyringPair } from '@polkadot/keyring/types';
import { xxApi } from '../api';
import { xxKeyring } from '../keyring';

export type TxStatus =
  | 'idle'
  | 'signing'
  | 'broadcasting'
  | 'in-block'
  | 'finalized'
  | 'error';

export interface SubmitOptions {
  address: string;
  password: string;
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

        // unlock() is async because wallet.xx.network JSON uses scrypt N=131072
        // which requires an awaited key derivation step.
        pair = await xxKeyring.unlock(opts.address, opts.password);

        const api = await xxApi.getApi();
        const extrinsic = builder(api);

        setStatus('broadcasting');
        return await new Promise<string>((resolve, reject) => {
          extrinsic
            .signAndSend(pair!, ({ status: s, txHash: hash, dispatchError }) => {
              setTxHash(hash.toHex());
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
            })
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
