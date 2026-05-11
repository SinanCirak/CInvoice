import { type FormEvent, useState } from 'react'
import { signInWithEmail, isAuthEnforced } from './auth/cognito'

const brandLogoPath = '/logo.png'
const APP_BRAND = 'CInvoice'

export default function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enforced = isAuthEnforced()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!enforced) {
      setError('Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_USER_POOL_CLIENT_ID for production builds.')
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

        {!enforced && (
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Cognito env vars are missing, so the app runs in <strong>open</strong> mode locally. Add{' '}
            <code>VITE_COGNITO_USER_POOL_ID</code>, <code>VITE_COGNITO_USER_POOL_CLIENT_ID</code>, and optional{' '}
            <code>VITE_AWS_REGION</code> to require login.
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
              disabled={!enforced || busy}
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
              disabled={!enforced || busy}
            />
          </label>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary login-submit" disabled={!enforced || busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
