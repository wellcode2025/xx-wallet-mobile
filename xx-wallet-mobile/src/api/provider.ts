/**
 * xx network API connection singleton.
 *
 * Manages a single WebSocket connection to an xx network RPC node.
 * All blockchain reads and writes go through this singleton.
 *
 * The connection is lazy — it's only established when `getApi()` is first
 * called, and can be reconnected to a different endpoint via `reconnect()`.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { DEFAULT_ENDPOINT } from './constants';
import { xxTypes } from './xxTypes';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type StatusListener = (status: ConnectionStatus, endpoint: string) => void;

class XxApiConnection {
  private api: ApiPromise | null = null;
  private provider: WsProvider | null = null;
  private currentEndpoint: string = DEFAULT_ENDPOINT;
  private status: ConnectionStatus = 'disconnected';
  private listeners = new Set<StatusListener>();
  private connectPromise: Promise<ApiPromise> | null = null;

  /** Subscribe to connection status changes. Returns an unsubscribe fn. */
  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.status, this.currentEndpoint);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((l) => l(status, this.currentEndpoint));
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getEndpoint(): string {
    return this.currentEndpoint;
  }

  /**
   * Get the ApiPromise instance, connecting if necessary.
   * Throws if connection fails.
   */
  async getApi(): Promise<ApiPromise> {
    if (this.api?.isConnected) return this.api;
    if (this.connectPromise) return this.connectPromise;
    return this.connect(this.currentEndpoint);
  }

  /** Connect (or reconnect) to a specific endpoint. */
  async connect(endpoint: string): Promise<ApiPromise> {
    // If we're switching endpoints, tear down the old connection first
    if (this.api && this.currentEndpoint !== endpoint) {
      await this.disconnect();
    }

    if (this.api?.isConnected && this.currentEndpoint === endpoint) {
      return this.api;
    }

    this.currentEndpoint = endpoint;
    this.setStatus('connecting');

    this.connectPromise = (async () => {
      try {
        this.provider = new WsProvider(endpoint, 5000);

        this.provider.on('connected', () => this.setStatus('connected'));
        this.provider.on('disconnected', () => this.setStatus('disconnected'));
        this.provider.on('error', () => this.setStatus('error'));

        this.api = await ApiPromise.create({
          provider: this.provider,
          typesBundle: {
            spec: {
              xxnetwork: xxTypes,
            },
          },
          // throwOnConnect makes failures easier to catch in the UI
          throwOnConnect: true,
          // Quiet the console in production
          noInitWarn: true,
        });

        await this.api.isReady;
        this.setStatus('connected');
        return this.api;
      } catch (err) {
        this.setStatus('error');
        this.api = null;
        this.provider = null;
        throw err;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  /** Disconnect and tear down the current connection. */
  async disconnect(): Promise<void> {
    if (this.api) {
      try {
        await this.api.disconnect();
      } catch {
        // Ignore — we're tearing down anyway
      }
      this.api = null;
    }
    if (this.provider) {
      try {
        await this.provider.disconnect();
      } catch {
        // Ignore
      }
      this.provider = null;
    }
    this.setStatus('disconnected');
  }

  /**
   * Switch to a different RPC endpoint.
   * Closes the current connection and opens a new one.
   */
  async reconnect(endpoint: string): Promise<ApiPromise> {
    await this.disconnect();
    return this.connect(endpoint);
  }
}

/** The global API connection. Use this everywhere. */
export const xxApi = new XxApiConnection();
export type { ConnectionStatus };
