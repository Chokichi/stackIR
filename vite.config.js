import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Ketcher (and some of its dependencies such as draft-js) read `process.env`
  // at runtime. Vite does not polyfill Node globals by default, so expose a
  // minimal shim to avoid "process is not defined" runtime errors.
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'development'
    ),
    'process.env': {},
    global: 'globalThis',
  },
  build: {
    // ketcher-core's published ESM bundle contains a literal
    // `require('raphael')` call (guarded by `typeof window !== 'undefined'`).
    // Rollup's CommonJS plugin ignores require() inside ES modules unless
    // transformMixedEsModules is enabled, which left `require` in the
    // production chunk and broke the Insert/Edit structure modal in
    // deployed builds.
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ['ketcher-core', 'ketcher-react', 'ketcher-standalone', 'raphael'],
  },
})
