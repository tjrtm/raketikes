import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // rapier-compat inlines its WASM as base64, so its chunk is known-large;
    // real budgets are enforced by `npm run size` (scripts/check-size.mjs)
    chunkSizeWarningLimit: 2200,
    // three and rapier are big, stable vendor deps — split them so app-code
    // changes don't invalidate their cache entries. peerjs is dynamically
    // imported (see net/session.ts) and becomes its own lazy chunk on its own.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
