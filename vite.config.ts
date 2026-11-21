import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Rust API runs beside Vite (npm run api). On Vercel the same paths reach the function.
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://127.0.0.1:8787' } } });
