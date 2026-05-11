import { type FormEvent, useState } from 'react'
import { isCognitoConfigured, signInWithEmail } from './auth/cognito'

const brandLogoPath = '/logo.png'
const APP_BRAND = 'CInvoice'

export default function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cognitoReady = isCognitoConfigured()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!cognitoReady) {
      setError(
        'Cognito is not configured in this build. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_USER_POOL_CLIENT_ID (for example in .env.local when developing, or GitHub Actions secrets for deploys), then restart / rebuild.',
      )
      return
    }
    setBusy(true)
    try {
      await signInWithEmail(email, password)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <span className="brand-badge brand-logo-box">
            <img src={brandLogoPath} alt="" className="brand-logo" width={48} height={48} />
          </span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.35rem' }}>{APP_BRAND}</h1>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Sign in with your workspace account
            </p>
          </div>
        </div>

        {!cognitoReady && (
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            This build is missing <code>VITE_COGNITO_USER_POOL_ID</code> and{' '}
            <code>VITE_COGNITO_USER_POOL_CLIENT_ID</code>. Local and production behave the same: add the same
            variables you use in production to your local <code>.env.local</code> if you run <code>npm run dev</code>{' '}
            here.
          </p>
        )}

        <form className="login-form" onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={!cognitoReady || busy}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={!cognitoReady || busy}
            />
          </label>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary login-submit" disabled={!cognitoReady || busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
