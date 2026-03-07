/// <reference types="vite/client" />

// Ensure the global Window augmentation from shared types is included in this TS program.
import type {} from '@weighbridge/shared/types';

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
