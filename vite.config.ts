import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use relative asset paths so the build works whether it's served at
  // domain root (/) or from a sub-path (for example GitHub Pages).
  base: './',
})
