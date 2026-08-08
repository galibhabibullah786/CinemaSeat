/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_MOCK_CONFLICT?: string;
  readonly VITE_MOCK_PAYMENT_FAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
