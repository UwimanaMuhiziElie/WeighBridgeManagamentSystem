import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './', 
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared'),
    },
  },
  server: {
    host: true,       
    port: 5174,       
    strictPort: true,  
  },
  preview: {
    host: true,
    port: 5174,
    strictPort: true,
  }
});
