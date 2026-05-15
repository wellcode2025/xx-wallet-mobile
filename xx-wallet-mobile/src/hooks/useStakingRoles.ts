/**
 * useStakingRoles — the active account's *current* on-chain roles
 * (validator / nominator / council / techcommit / special), from the
 * indexer.
 *
 * Wraps fetchAccountRoles. Indexer-sourced and fetch-once: roles change
 * at most once per era and this only drives a small header badge — not
 * worth a subscription. Returns null while loading, on error, or when
 * the address has no indexer account row.
 *
 * These flags are *currently-is*, not *has-ever-been* — an ex-validator
 * who has chilled returns validator:false. See AccountRoles in
 * src/api/identity.ts for that distinction.
 */

import { useEffect, useState } from 'react';
import { fetchAccountRoles, type AccountRoles } from '@/api';

export function useStakingRoles(address: string | null | undefined): {
  roles: AccountRoles | null;
  isLoading: boolean;
} {
  const [roles, setRoles] = useState<AccountRoles | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setRoles(null);
      return;
    }

    let cancelled = false;
    setRoles(null);
    setIsLoading(true);

    fetchAccountRoles(address)
      .then((r) => {
        if (cancelled) return;
        setRoles(r);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRoles(null);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { roles, isLoading };
}
