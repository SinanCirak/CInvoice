import { getIdToken } from './auth/cognito'

function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ?? ''
  return raw.replace(/\/$/, '')
}

/** Shown when the SPA was built without the API Gateway invoke URL. */
export const MISSING_API_GATEWAY_URL =
  'Add VITE_API_BASE_URL to the build (Terraform HTTP API invoke URL) so the browser can call Lambda.'

export function isApiConfigured(): boolean {
  return apiBase().length > 0
}

async function jsonHeaders(): Promise<HeadersInit> {
  const token = await getIdToken()
  if (!token) {
    throw new Error('Not signed in or session expired; sign in again.')
  }
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  h.Authorization = `Bearer ${token}`
  return h
}

export type WorkspaceSnapshot = Record<string, unknown>

export async function fetchWorkspaceFromAws(): Promise<WorkspaceSnapshot | null> {
  const b = apiBase()
  if (!b) return null
  const token = await getIdToken()
  if (!token) return null
  const res = await fetch(`${b}/workspace`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`Workspace load failed: ${res.status}`)
  }
  const data = (await res.json()) as { workspace?: WorkspaceSnapshot | null }
  return data.workspace ?? null
}

export async function putWorkspaceToAws(workspace: WorkspaceSnapshot): Promise<void> {
  const b = apiBase()
  if (!b) {
    throw new Error(MISSING_API_GATEWAY_URL)
  }
  const token = await getIdToken()
  if (!token) {
    throw new Error('Not signed in or session expired; sign in again to save.')
  }
  const res = await fetch(`${b}/workspace`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workspace }),
  })
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error(
        'Workspace is too large for DynamoDB (even without inline logo). Remove old data or split exports.',
      )
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Session expired or unauthorized. Please sign in again.')
    }
    const text = await res.text().catch(() => '')
    throw new Error(text || `Workspace save failed: ${res.status}`)
  }
}

export async function putStripeSettingsToAws(payload: {
  stripeSecretKey?: string
  stripeWebhookSecret?: string
}): Promise<void> {
  const b = apiBase()
  if (!b) {
    throw new Error(MISSING_API_GATEWAY_URL)
  }
  const body: Record<string, string> = {}
  if (payload.stripeSecretKey?.trim()) body.stripeSecretKey = payload.stripeSecretKey.trim()
  if (payload.stripeWebhookSecret?.trim()) body.stripeWebhookSecret = payload.stripeWebhookSecret.trim()
  if (Object.keys(body).length === 0) {
    throw new Error('Add a Stripe secret key and/or webhook secret before saving to the server.')
  }
  const res = await fetch(`${b}/settings/stripe`, {
    method: 'PUT',
    headers: await jsonHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
}

export async function uploadInvoicePdfToS3IfConfigured(pdfBlob: Blob, invoiceId: string): Promise<string | null> {
  const b = apiBase()
  if (!b) return null
  const token = await getIdToken()
  if (!token) return null

  const presignRes = await fetch(`${b}/invoices/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ invoiceId }),
  })
  if (!presignRes.ok) {
    throw new Error(`Presign failed: ${presignRes.status}`)
  }
  const data = (await presignRes.json()) as { uploadUrl?: string; objectKey?: string }
  if (!data.uploadUrl) throw new Error('No uploadUrl in presign response')

  const putRes = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdfBlob,
  })
  if (!putRes.ok) {
    throw new Error(`S3 upload failed: ${putRes.status}`)
  }
  return data.objectKey ?? null
}

/** Presigned GET for a PDF the user already uploaded (key must be under invoices/<sub>/). */
export async function getInvoicePdfDownloadUrl(objectKey: string): Promise<string | null> {
  const b = apiBase()
  if (!b) return null
  const token = await getIdToken()
  if (!token) return null
  const res = await fetch(`${b}/invoices/download-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objectKey }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { downloadUrl?: string }
  return data.downloadUrl ?? null
}
