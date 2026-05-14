import { Amplify } from 'aws-amplify'
import { cognitoCredentialsProvider, cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito'
import { CookieStorage, defaultStorage } from 'aws-amplify/utils'
import { fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth'

let configured = false

function readAuthCookieDays(): number {
  const raw = import.meta.env.VITE_AUTH_COOKIE_DAYS
  const n = raw != null && String(raw).trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3650) : 30
}

function useLocalStorageForTokens(): boolean {
  const mode = import.meta.env.VITE_AUTH_TOKEN_STORAGE?.trim().toLowerCase()
  return mode === 'local' || mode === 'localstorage'
}

/**
 * Configure Amplify once: Cognito + token store (cookies by default, like a long-lived browser session).
 * Cookies use `secure` only on HTTPS so `npm run dev` on http://localhost still works.
 */
function ensureConfigured() {
  if (configured) return
  const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim()
  const clientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID?.trim()
  const region = import.meta.env.VITE_AWS_REGION?.trim() || 'ca-central-1'
  if (!poolId || !clientId) return

  const authResources = {
    Cognito: {
      userPoolId: poolId,
      userPoolClientId: clientId,
      region,
    },
  }

  const keyValueStorage = useLocalStorageForTokens()
    ? defaultStorage
    : new CookieStorage({
        path: '/',
        expires: readAuthCookieDays(),
        sameSite: 'lax',
        secure: typeof window !== 'undefined' ? window.location.protocol === 'https:' : true,
        ...(import.meta.env.VITE_AUTH_COOKIE_DOMAIN?.trim()
          ? { domain: import.meta.env.VITE_AUTH_COOKIE_DOMAIN.trim() }
          : {}),
      })

  cognitoUserPoolsTokenProvider.setKeyValueStorage(keyValueStorage)
  cognitoUserPoolsTokenProvider.setAuthConfig(authResources)

  Amplify.configure(
    { Auth: authResources },
    {
      Auth: {
        tokenProvider: cognitoUserPoolsTokenProvider,
        credentialsProvider: cognitoCredentialsProvider,
      },
    },
  )
  configured = true
}

/** Pool + app client present in the build (same expectation locally and in production). */
export function isCognitoConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim() && import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID?.trim(),
  )
}

export async function checkSignedIn(): Promise<boolean> {
  if (!isCognitoConfigured()) return false
  ensureConfigured()
  try {
    await getCurrentUser()
    return true
  } catch {
    return false
  }
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  ensureConfigured()
  await signIn({ username: email.trim(), password })
}

export async function signOutUser(): Promise<void> {
  if (!isCognitoConfigured()) return
  ensureConfigured()
  try {
    await signOut()
  } catch {
    /* already signed out */
  }
}

/** Display name for header (email from ID token, else Cognito username). */
export async function getAuthUserDisplay(): Promise<string | null> {
  if (!isCognitoConfigured()) return null
  ensureConfigured()
  try {
    const user = await getCurrentUser()
    const session = await fetchAuthSession()
    const payload = session.tokens?.idToken?.payload as Record<string, unknown> | undefined
    const email = typeof payload?.email === 'string' ? payload.email.trim() : ''
    if (email) return email
    const preferred = typeof payload?.preferred_username === 'string' ? payload.preferred_username.trim() : ''
    if (preferred) return preferred
    return user.username?.trim() || null
  } catch {
    return null
  }
}

function tokenToString(token: unknown): string | null {
  if (!token) return null
  if (typeof token === 'string') return token
  if (typeof token === 'object' && token !== null && 'toString' in token) {
    return (token as { toString: () => string }).toString()
  }
  return null
}

/** ID token for API Gateway JWT authorizer. */
export async function getIdToken(): Promise<string | null> {
  if (!isCognitoConfigured()) return null
  ensureConfigured()
  try {
    let session = await fetchAuthSession()
    let id = tokenToString(session.tokens?.idToken)
    if (!id) {
      session = await fetchAuthSession({ forceRefresh: true })
      id = tokenToString(session.tokens?.idToken)
    }
    return id
  } catch {
    return null
  }
}
