/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string
  readonly VITE_AWS_REGION?: string
  /** Optional: e.g. .example.com so auth cookies work across subdomains (HTTPS only in prod). */
  readonly VITE_AUTH_COOKIE_DOMAIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
