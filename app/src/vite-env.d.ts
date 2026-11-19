/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_NODE?: string;
  readonly VITE_FAUCET_URL?: string;
  readonly VITE_SNAP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
