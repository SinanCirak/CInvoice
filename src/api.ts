function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ?? ''
  return raw.replace(/\/$/, '')
}

export function isApiConfigured(): boolean {
  return apiBase().length > 0
}

/**
 * Persists Stripe secrets to DynamoDB via the deployed HTTP API (see terraform).
 * Only sends non-empty fields; at least one field must be provided.
 */
export async function putStripeSettingsToAws(payload: {
  stripeSecretKey?: string
  stripeWebhookSecret?: string
}): Promise<void> {
  const b = apiBase()
  const body: Record<string, string> = {}
  if (payload.stripeSecretKey?.trim()) body.stripeSecretKey = payload.stripeSecretKey.trim()
  if (payload.stripeWebhookSecret?.trim()) body.stripeWebhookSecret = payload.stripeWebhookSecret.trim()
  if (Object.keys(body).length === 0) {
    throw new Error('Add a Stripe secret key and/or webhook secret before saving to the server.')
  }
  const res = await fetch(`${b}/settings/stripe`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
}

/**
 * After generating a PDF in the browser, optionally uploads the same bytes to S3 using the presign route.
 */
export async function uploadInvoicePdfToS3IfConfigured(pdfBlob: Blob, invoiceId: string): Promise<void> {
  const b = apiBase()
  if (!b) return

  const presignRes = await fetch(`${b}/invoices/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId }),
  })
  if (!presignRes.ok) {
    throw new Error(`Presign failed: ${presignRes.status}`)
  }
  const data = (await presignRes.json()) as { uploadUrl?: string }
  if (!data.uploadUrl) throw new Error('No uploadUrl in presign response')

  const putRes = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdfBlob,
  })
  if (!putRes.ok) {
    throw new Error(`S3 upload failed: ${putRes.status}`)
  }
}
