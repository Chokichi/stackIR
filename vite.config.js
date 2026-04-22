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
})
