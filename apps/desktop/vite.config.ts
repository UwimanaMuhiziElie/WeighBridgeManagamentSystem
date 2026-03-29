import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { builtinModules } from 'module';

const electronExternal = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  
  'serialport',
  '@serialport/bindings-cpp',
  '@serialport/parser-readline',
];

export default defineConfig({
  // important for Electron packaged builds (file://)
  base: './',

  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            sourcemap: true,
            rollupOptions: { external: electronExternal },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            sourcemap: true,
            rollupOptions: { external: electronExternal },
          },
        },
      },
    }),

    // better handling of node builtins / electron in renderer
    electronRenderer(),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared'),
      '@weighbridge/shared': path.resolve(__dirname, '../../packages/shared'),
    },
  },


  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
