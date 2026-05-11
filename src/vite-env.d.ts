/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string
  readonly VITE_AWS_REGION?: string
  /** Optional: e.g. .example.com so auth cookies work across subdomains (HTTPS only in prod). */
  readonly VITE_AUTH_COOKIE_DOMAIN?: string
  /**
   * Set to `cookie` to store Cognito tokens in cookies (can fail for large JWTs in some browsers).
   * Omit or any other value: use Amplify default (localStorage) — recommended for API Bearer calls.
   */
  readonly VITE_AUTH_TOKEN_STORAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
