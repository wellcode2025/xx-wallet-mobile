/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'xx Wallet',
        short_name: 'xx',
        description: 'Mobile wallet for the xx network',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Include .wasm so the Sleeve module is precached and works offline once installed.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        // Don't cache the WS endpoint — we always want fresh blockchain data
        navigateFallbackDenylist: [/^\/api/],
        // Sleeve WASM is ~2 MB; raise the per-file precache cap so it doesn't get skipped silently.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'polkadot-api': ['@polkadot/api'],
          'polkadot-crypto': ['@polkadot/util-crypto', '@polkadot/keyring'],
        },
      },
    },
  },
  optimizeDeps: {
    // Polkadot packages need to be pre-bundled for dev speed
    include: [
      '@polkadot/api',
      '@polkadot/keyring',
      '@polkadot/util',
      '@polkadot/util-crypto',
    ],
  },
  test: {
    // Pure-function tests don't need a DOM. Keep node env for speed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Scrypt with N=131072 takes a few seconds in pure JS — give some headroom.
    testTimeout: 30000,
  },
});
