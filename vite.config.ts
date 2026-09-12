import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer build config. base: './' keeps asset URLs relative so the built
// index.html loads correctly from a file:// URL in packaged/production runs.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
})
