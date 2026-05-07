/**
 * useBalance — subscribe to an account's live balance.
 *
 * Returns the free, reserved, frozen, and total balances for an address,
 * updating in real-time as new blocks arrive.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '../api';

export interface AccountBalance {
  free: BN;
  reserved: BN;
  frozen: BN;
  /** free + reserved */
  total: BN;
  /** Balance that can actually be sent (free minus frozen, but not below 0) */
  transferable: BN;
}

export function useBalance(address: string | null | undefined): {
  balance: AccountBalance | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }

    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const sub = await api.query.system.account(address, (raw: any) => {
          const data = raw.data;
          const free = data.free.toBn();
          const reserved = data.reserved.toBn();
          // Substrate chains may use `frozen` or legacy `miscFrozen`/`feeFrozen`
          const frozen =
            data.frozen?.toBn?.() ??
            data.miscFrozen?.toBn?.() ??
            free.sub(free); // zero BN
          const total = free.add(reserved);
          const transferable = free.sub(frozen).ltn(0)
            ? free.sub(free)
            : free.sub(frozen);

          setBalance({ free, reserved, frozen, total, transferable });
          setIsLoading(false);
        });

        // polkadot's callback subscription returns the unsubscribe function at
        // runtime, but the TS overload widens it to Codec. Safe to cast.
        unsub = sub as unknown as (() => void);
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [address]);

  return { balance, isLoading, error };
}
