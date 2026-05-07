/**
 * useApi — convenience hook for one-shot API access inside components.
 *
 * For subscriptions, prefer purpose-built hooks like useBalance.
 */

import { useEffect, useState } from 'react';
import type { ApiPromise } from '@polkadot/api';
import { xxApi } from '../api';

export function useApi(): ApiPromise | null {
  const [api, setApi] = useState<ApiPromise | null>(null);

  useEffect(() => {
    let cancelled = false;
    xxApi.getApi().then((a) => {
      if (!cancelled) setApi(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return api;
}
