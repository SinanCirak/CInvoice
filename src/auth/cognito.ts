import { Amplify } from 'aws-amplify'
import { fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth'

let configured = false

function ensureConfigured() {
  if (configured) return
  const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim()
  const clientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID?.trim()
  if (!poolId || !clientId) return
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: poolId,
        userPoolClientId: clientId,
      },
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

/** Cognito ID token for API Gateway JWT authorizer (Bearer). */
export async function getIdToken(): Promise<string | null> {
  if (!isCognitoConfigured()) return null
  ensureConfigured()
  const session = await fetchAuthSession()
  const id = session.tokens?.idToken
  if (!id) return null
  return typeof id === 'string' ? id : id.toString()
}
