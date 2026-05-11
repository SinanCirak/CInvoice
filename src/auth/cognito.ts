import { Amplify, type ResourcesConfig } from 'aws-amplify'
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito'
import { fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth'
import { CookieStorage } from 'aws-amplify/utils'

let configured = false

function buildAuthCookieStorage(): CookieStorage {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const domain = import.meta.env.VITE_AUTH_COOKIE_DOMAIN?.trim()
  const useDomain = Boolean(domain && host && !host.includes('localhost'))
  return new CookieStorage({
    path: '/',
    /** Match Cognito app client refresh_token_validity (terraform: 30 days). */
    expires: 30,
    sameSite: 'lax',
    secure: isHttps,
    ...(useDomain ? { domain } : {}),
  })
}

function ensureConfigured() {
  if (configured) return
  const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim()
  const clientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID?.trim()
  if (!poolId || !clientId) return

  const resourceConfig: ResourcesConfig = {
    Auth: {
      Cognito: {
        userPoolId: poolId,
        userPoolClientId: clientId,
      },
    },
  }

  cognitoUserPoolsTokenProvider.setAuthConfig(resourceConfig.Auth!)
  cognitoUserPoolsTokenProvider.setKeyValueStorage(buildAuthCookieStorage())

  Amplify.configure(resourceConfig, {
    Auth: {
      tokenProvider: cognitoUserPoolsTokenProvider,
    },
  })
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

/** Cognito ID token for API Gateway JWT authorizer (Bearer). Refreshes via refresh token when expired. */
export async function getIdToken(): Promise<string | null> {
  if (!isCognitoConfigured()) return null
  ensureConfigured()
  try {
    const session = await fetchAuthSession()
    const id = session.tokens?.idToken
    if (!id) return null
    return typeof id === 'string' ? id : id.toString()
  } catch {
    return null
  }
}
