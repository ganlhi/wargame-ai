import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative asset URLs, so the build works wherever it is served from — the
  // root in dev, and https://<user>.github.io/<repo>/ on GitHub Pages. The app
  // is a single page with no client-side routing, so nothing needs to know the
  // subpath at runtime.
  base: './',
  plugins: [react(), tailwindcss()],
})
