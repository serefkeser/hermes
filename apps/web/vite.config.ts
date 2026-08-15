import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/hermes/',
  resolve: {
    alias: {
      '@otonom/types': path.resolve(__dirname, '../../packages/shared-types/src'),
      '@otonom/config': path.resolve(__dirname, '../../packages/shared-config/src'),
      '@otonom/utils': path.resolve(__dirname, '../../packages/shared-utils/src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          shared: ['@otonom/shared-types', '@otonom/shared-config', '@otonom/shared-utils'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});