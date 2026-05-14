/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string
  readonly VITE_AWS_REGION?: string
  /** Optional: e.g. .example.com so auth cookies work across subdomains (HTTPS only in prod). */
  readonly VITE_AUTH_COOKIE_DOMAIN?: string
  /** Optional: session cookie lifetime in days (default 30). */
  readonly VITE_AUTH_COOKIE_DAYS?: string
  /**
   * `cookie` / `cookies`: store Cognito tokens in cookies (optional; large JWTs can exceed cookie limits).
   * Omit or any other value: localStorage (Amplify default, recommended).
   */
  readonly VITE_AUTH_TOKEN_STORAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
