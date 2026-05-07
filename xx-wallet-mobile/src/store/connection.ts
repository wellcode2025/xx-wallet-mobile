/**
 * Connection store.
 *
 * Tracks the live status of the RPC WebSocket connection so any component
 * can reactively show "connected", "connecting", or "disconnected".
 */

import { create } from 'zustand';
import { xxApi, type ConnectionStatus } from '../api';

interface ConnectionState {
  status: ConnectionStatus;
  endpoint: string;
  /** Chain name as reported by the node, e.g. "xxnetwork". */
  chainName: string | null;
  /** Last observed block number. */
  blockNumber: number | null;

  init(): () => void;
  setEndpoint(endpoint: string): Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set) => {
  let unsubscribeStatus: (() => void) | null = null;
  let unsubscribeBlocks: (() => void) | null = null;

  return {
    status: 'disconnected',
    endpoint: xxApi.getEndpoint(),
    chainName: null,
    blockNumber: null,

    /** Call once at app startup. Returns a cleanup function. */
    init() {
      // Subscribe to connection status
      unsubscribeStatus = xxApi.onStatusChange((status, endpoint) => {
        set({ status, endpoint });

        if (status === 'connected') {
          // Once connected, get chain info + subscribe to new blocks
          xxApi.getApi().then(async (api) => {
            try {
              const chain = await api.rpc.system.chain();
              set({ chainName: chain.toString() });

              if (unsubscribeBlocks) unsubscribeBlocks();
              const unsub = await api.rpc.chain.subscribeNewHeads((header) => {
                set({ blockNumber: header.number.toNumber() });
              });
              unsubscribeBlocks = () => unsub();
            } catch (err) {
              console.error('Failed to fetch chain info', err);
            }
          });
        } else {
          if (unsubscribeBlocks) {
            unsubscribeBlocks();
            unsubscribeBlocks = null;
          }
          set({ chainName: null, blockNumber: null });
        }
      });

      // Kick off the initial connection
      xxApi.getApi().catch((err) => {
        console.error('Initial connection failed', err);
      });

      return () => {
        unsubscribeStatus?.();
        unsubscribeBlocks?.();
      };
    },

    async setEndpoint(endpoint: string) {
      set({ endpoint, status: 'connecting' });
      try {
        await xxApi.reconnect(endpoint);
      } catch (err) {
        console.error('Failed to switch endpoint', err);
        set({ status: 'error' });
      }
    },
  };
});
