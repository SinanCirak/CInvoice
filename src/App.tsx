import {
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  MISSING_API_GATEWAY_URL,
  deleteInvoiceFromAws,
  deleteClientFromAws,
  fetchWorkspaceFromAws,
  getInvoicePdfDownloadUrl,
  isApiConfigured,
  putStripeSettingsToAws,
  putWorkspaceToAws,
  uploadInvoicePdfToS3IfConfigured,
} from './api'
import { changeUserPassword, checkSignedIn, getAuthUserDisplay, isCognitoConfigured, signOutUser } from './auth/cognito'
import { Hub } from 'aws-amplify/utils'
import LoginPage from './LoginPage'

type CompanyProfile = {
  companyName: string
  ownerName: string
  email: string
  phone: string
  streetAddress: string
  city: string
  province: string
  postalCode: string
  logoDataUrl: string
  gstHstNumber: string
  invoiceNumberPrefix: string
  invoiceNumberYear: string
  paymentAccountName: string
  paymentInstitutionName: string
  paymentInstitutionNumber: string
  paymentTransitNumber: string
  paymentAccountNumber: string
  paymentEmail: string
  stripeAccountId: string
  stripePublishableKey: string
  stripeWebhookSecret: string
}

type CatalogItem = {
  id: number
  type: 'Service' | 'Product'
  name: string
  unit: 'Hour' | 'Unit'
  defaultPrice: number
  taxRate: number
}

type DraftInvoiceLine = CatalogItem & {
  quantity: number
  customPrice: number
}

type InvoiceRecord = {
  id: string
  invoiceNumber: string
  clientId?: string
  client: string
  issueDate: string
  dueDate: string
  totalAmount: number
  paidAmount: number
  status: 'Draft' | 'Open' | 'Partial' | 'Paid' | 'Overdue'
  paymentChannel?: 'Interac e-Transfer' | 'E-Transfer' | 'Interac' | 'Bank Transfer' | 'Credit Card' | 'Cash'
  pdfObjectKey?: string
  subtotal?: number
  tax?: number
  lines?: {
    name: string
    unit: string
    quantity: number
    price: number
    taxRate: number
    total?: number
  }[]
}

type ClientRecord = {
  id: string
  name: string
  email: string
  phone: string
  company: string
  streetAddress: string
  city: string
  province: string
  postalCode: string
  gstHstNumber: string
  totalInvoiced: number
}

type InvoiceMeta = {
  invoiceNumber: string
  issueDate: string
  dueDate: string
  status: 'Draft' | 'Open' | 'Paid'
  paymentTerms: string
  notes: string
  discount: number
  shipping: number
}

const APP_BRAND = 'CInvoice'

/** Empty shell: real data comes from DynamoDB after sign-in (or localStorage only when Cognito is not configured). */
const initialProfile: CompanyProfile = {
  companyName: '',
  ownerName: '',
  email: '',
  phone: '',
  streetAddress: '',
  city: '',
  province: 'ON',
  postalCode: '',
  logoDataUrl: '',
  gstHstNumber: '',
  invoiceNumberPrefix: 'INV',
  invoiceNumberYear: new Date().getFullYear().toString(),
  paymentAccountName: '',
  paymentInstitutionName: '',
  paymentInstitutionNumber: '',
  paymentTransitNumber: '',
  paymentAccountNumber: '',
  paymentEmail: '',
  stripeAccountId: '',
  stripePublishableKey: '',
  stripeWebhookSecret: '',
}

const PROFILE_STORAGE_KEY = 'cinvoice_company_profile_v1'

function readStoredCompanyProfile(): CompanyProfile {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return initialProfile
  }
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw?.trim()) return initialProfile
    const parsed = JSON.parse(raw) as Partial<CompanyProfile>
    if (!parsed || typeof parsed !== 'object') return initialProfile
    return { ...initialProfile, ...parsed }
  } catch {
    return initialProfile
  }
}

const brandLogoPath = '/logo.png'

const CANADA_PROVINCES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const

type UiIconName = 'search' | 'filter' | 'columns' | 'edit' | 'save' | 'view' | 'check' | 'trash' | 'menu' | 'close'

function UiIcon({ name }: { name: UiIconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'menu') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" {...common} />
      </svg>
    )
  }
  if (name === 'close') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" {...common} />
      </svg>
    )
  }
  if (name === 'search') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" {...common} />
        <path d="M20 20l-3.5-3.5" {...common} />
      </svg>
    )
  }
  if (name === 'filter') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16l-6.5 7v5l-3-1.8V13L4 6z" {...common} />
      </svg>
    )
  }
  if (name === 'columns') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="5" height="14" rx="1.5" {...common} />
        <rect x="9.5" y="5" width="5" height="14" rx="1.5" {...common} />
        <rect x="16" y="5" width="5" height="14" rx="1.5" {...common} />
      </svg>
    )
  }
  if (name === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l10-10-4-4L4 16v4z" {...common} />
        <path d="M12.5 7.5l4 4" {...common} />
      </svg>
    )
  }
  if (name === 'save') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h11l3 3v13H5V4z" {...common} />
        <path d="M8 4v6h8V4" {...common} />
        <rect x="8" y="14" width="8" height="6" rx="1.5" {...common} />
      </svg>
    )
  }
  if (name === 'view') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" {...common} />
        <circle cx="12" cy="12" r="2.8" {...common} />
      </svg>
    )
  }
  if (name === 'trash') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16" {...common} />
        <path d="M9 7V5h6v2" {...common} />
        <path d="M7 7l1 12h8l1-12" {...common} />
        <path d="M10 11v5M14 11v5" {...common} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l4 4 10-10" {...common} />
    </svg>
  )
}

/** PDF palette: same green family as logo, muted / lower chroma for less eye strain */
const PDF_BRAND = {
  headerBg: [38, 58, 52] as const,
  headerRule: [64, 88, 80] as const,
  headerRuleHairline: [54, 78, 70] as const,
  logoBoxStroke: [148, 172, 162] as const,
  headerInk: [252, 252, 251] as const,
  headerMuted: [212, 224, 218] as const,
  headerSoft: [220, 230, 224] as const,
  headerFaint: [188, 204, 196] as const,
  invoiceTitle: [228, 236, 230] as const,
  tableHeader: [62, 106, 90] as const,
  totalBar: [46, 86, 72] as const,
  totalsCardFill: [252, 252, 251] as const,
  totalsCardStroke: [216, 224, 220] as const,
  metaFill: [244, 247, 245] as const,
  metaStroke: [210, 218, 214] as const,
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  )
}

function invoiceRemainingAmount(invoice: InvoiceRecord): number {
  return Math.max(0, invoice.totalAmount - invoice.paidAmount)
}

function isInvoiceFullyPaid(invoice: InvoiceRecord): boolean {
  return invoice.status === 'Paid' || invoiceRemainingAmount(invoice) < 0.005
}

function parseIssueDateMs(isoDay: string): number {
  const t = Date.parse(`${isoDay}T12:00:00`)
  return Number.isFinite(t) ? t : 0
}

function normalizeCanadianPostalCode(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  if (cleaned.length <= 3) return cleaned
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`
}

type InvoicePaymentBlock = {
  hasContent: boolean
  eftLines: { label: string; value: string }[]
  etransferEmail: string
}

function buildInvoicePaymentBlock(profile: CompanyProfile): InvoicePaymentBlock {
  const eftLines: { label: string; value: string }[] = []
  const accountName = profile.paymentAccountName.trim()
  const bankName = profile.paymentInstitutionName.trim()
  const institution = profile.paymentInstitutionNumber.trim()
  const transit = profile.paymentTransitNumber.trim()
  const account = profile.paymentAccountNumber.trim()
  const etransferEmail = profile.paymentEmail.trim()

  if (accountName) eftLines.push({ label: 'Account name', value: accountName })
  if (bankName) eftLines.push({ label: 'Financial institution', value: bankName })
  if (institution) eftLines.push({ label: 'Institution No.', value: institution.padStart(3, '0') })
  if (transit) eftLines.push({ label: 'Transit No.', value: transit.padStart(5, '0') })
  if (account) eftLines.push({ label: 'Account No.', value: account })

  const hasEft = eftLines.length > 0
  return {
    hasContent: hasEft || etransferEmail.length > 0,
    eftLines,
    etransferEmail,
  }
}

function buildPaymentFooterLines(block: InvoicePaymentBlock): string[] {
  const lines: string[] = []
  const get = (label: string) => block.eftLines.find((row) => row.label === label)?.value

  if (block.eftLines.length) {
    const parts: string[] = ['EFT']
    const name = get('Account name')
    const bank = get('Financial institution')
    const inst = get('Institution No.')
    const transit = get('Transit No.')
    const acct = get('Account No.')
    if (name) parts.push(name)
    if (bank) parts.push(bank)
    if (inst && transit && acct) parts.push(`${inst}-${transit}-${acct}`)
    else {
      if (inst) parts.push(`Inst ${inst}`)
      if (transit) parts.push(`Transit ${transit}`)
      if (acct) parts.push(`Acct ${acct}`)
    }
    lines.push(parts.join(' · '))
  }
  if (block.etransferEmail) {
    lines.push(`Interac e-Transfer · ${block.etransferEmail}`)
  }
  return lines
}

function estimatePaymentFooterHeight(block: InvoicePaymentBlock, doc: import('jspdf').jsPDF, contentWidth: number): number {
  if (!block.hasContent) return 0
  let h = 6 + 4
  for (const line of buildPaymentFooterLines(block)) {
    h += Math.max(3.2, doc.splitTextToSize(line, contentWidth).length * 3.2)
  }
  return h + 6
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image file.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image.'))
    img.src = src
  })
}

async function convertImageToJpegDataUrl(src: string, maxDimensionPx = 256, quality = 0.85): Promise<string> {
  const img = await loadImageElement(src)
  const scale = Math.min(1, maxDimensionPx / Math.max(img.width || 1, img.height || 1))
  const targetW = Math.max(1, Math.round((img.width || 1) * scale))
  const targetH = Math.max(1, Math.round((img.height || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  ctx.drawImage(img, 0, 0, targetW, targetH)
  return canvas.toDataURL('image/jpeg', quality)
}

async function convertImageToPngDataUrl(src: string, maxDimensionPx = 640): Promise<string> {
  const img = await loadImageElement(src)
  const scale = Math.min(1, maxDimensionPx / Math.max(img.width || 1, img.height || 1))
  const targetW = Math.max(1, Math.round((img.width || 1) * scale))
  const targetH = Math.max(1, Math.round((img.height || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.drawImage(img, 0, 0, targetW, targetH)
  return canvas.toDataURL('image/png')
}

/** PDF logo is drawn ~28mm — embed a small JPEG, not the full S3/upload resolution. */
async function prepareLogoForPdf(logoSource: string): Promise<{ src: string; format: 'PNG' | 'JPEG' }> {
  const PDF_LOGO_MAX_PX = 256
  try {
    const src = await convertImageToJpegDataUrl(logoSource, PDF_LOGO_MAX_PX, 0.85)
    return { src, format: 'JPEG' }
  } catch {
    try {
      const src = await convertImageToPngDataUrl(logoSource, PDF_LOGO_MAX_PX)
      return { src, format: 'PNG' }
    } catch {
      return { src: logoSource, format: /\.jpe?g$/i.test(logoSource) ? 'JPEG' : 'PNG' }
    }
  }
}

function taxLabelForRate(rate: number): string {
  if (rate === 0) return 'Tax-exempt (0%)'
  if (rate === 5) return 'GST (5%)'
  if (rate === 13) return 'HST / GST (13%)'
  if (rate === 14) return 'HST (14%)'
  if (rate === 15) return 'HST (15%)'
  return `Sales tax (${rate}%)`
}

function taxShortLabel(rate: number): string {
  if (rate === 0) return '0%'
  if (rate === 5) return 'GST 5%'
  if (rate === 13) return 'HST 13%'
  return `${rate}%`
}

function aggregateTaxByRate(lines: DraftInvoiceLine[]): { rate: number; amount: number; label: string }[] {
  const map = new Map<number, number>()
  for (const line of lines) {
    const base = line.quantity * line.customPrice
    const t = base * (line.taxRate / 100)
    map.set(line.taxRate, (map.get(line.taxRate) ?? 0) + t)
  }
  return [...map.entries()]
    .map(([rate, amount]) => ({ rate, amount, label: taxLabelForRate(rate) }))
    .sort((a, b) => a.rate - b.rate)
}

function getNextInvoiceNumber(prefix: string, year: string, invoices: InvoiceRecord[]): string {
  const p = (prefix || 'INV').trim()
  const rawYear = (year || '').trim()
  const y = (rawYear.match(/^\d{4}$/) ? rawYear : new Date().getFullYear().toString()) as string
  const re = new RegExp(`^${escapeRegExp(p)}-${escapeRegExp(y)}-(\\d+)$`)
  let max = 0
  for (const inv of invoices) {
    const m = inv.invoiceNumber.match(re)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${p}-${y}-${String(max + 1).padStart(3, '0')}`
}

function parseClientSequence(id: string): number | null {
  const m = /^cl-(\d+)$/i.exec(id.trim())
  if (!m) return null
  if (m[1].length > 4) return null
  return parseInt(m[1], 10)
}

function getNextClientId(clients: ClientRecord[]): string {
  let max = 0
  for (const client of clients) {
    const seq = parseClientSequence(client.id)
    if (seq != null) max = Math.max(max, seq)
  }
  return `CL-${String(max + 1).padStart(3, '0')}`
}

function formatClientIdDisplay(id: string): string {
  const seq = parseClientSequence(id)
  if (seq != null) return `CL-${String(seq).padStart(3, '0')}`
  return id.toUpperCase()
}

type DashboardChartPeriod = 'week' | 'month' | '6month' | 'year'

type DashboardBucket = {
  label: string
  billed: number
  paid: number
  tax: number
}

function invoiceTaxAmount(inv: InvoiceRecord): number {
  if (typeof inv.tax === 'number' && inv.tax >= 0) return inv.tax
  if (inv.lines?.length) {
    return inv.lines.reduce((acc, line) => {
      const base = line.quantity * line.price
      return acc + base * (line.taxRate / 100)
    }, 0)
  }
  return 0
}

function buildDashboardBuckets(
  invoices: InvoiceRecord[],
  period: DashboardChartPeriod,
  now: Date,
): DashboardBucket[] {
  const buckets: DashboardBucket[] = []

  const sumForRange = (startMs: number, endMs: number) => {
    let billed = 0
    let paid = 0
    let tax = 0
    for (const inv of invoices) {
      const t = parseIssueDateMs(inv.issueDate)
      if (t >= startMs && t <= endMs) {
        billed += inv.totalAmount
        paid += inv.paidAmount
        tax += invoiceTaxAmount(inv)
      }
    }
    return { billed, paid, tax }
  }

  if (period === 'week') {
    for (let back = 6; back >= 0; back--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
      const startMs = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
      const endMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime()
      const totals = sumForRange(startMs, endMs)
      buckets.push({
        label: day.toLocaleString('en-CA', { weekday: 'short' }),
        ...totals,
      })
    }
    return buckets
  }

  if (period === 'month') {
    for (let w = 3; w >= 0; w--) {
      const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - w * 7, 23, 59, 59, 999)
      const weekStart = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 6, 0, 0, 0)
      const totals = sumForRange(weekStart.getTime(), weekEnd.getTime())
      buckets.push({
        label: `W${4 - w}`,
        ...totals,
      })
    }
    return buckets
  }

  const monthCount = period === '6month' ? 6 : 12
  for (let back = monthCount - 1; back >= 0; back--) {
    const anchor = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const startMs = anchor.getTime()
    const endMs = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999).getTime()
    const totals = sumForRange(startMs, endMs)
    buckets.push({
      label: anchor.toLocaleString('en-CA', { month: period === 'year' ? 'short' : 'short', year: period === 'year' ? '2-digit' : undefined }),
      ...totals,
    })
  }
  return buckets
}

function createInvoiceMetaFromProfile(profile: CompanyProfile, invoices: InvoiceRecord[]): InvoiceMeta {
  return {
    invoiceNumber: getNextInvoiceNumber(profile.invoiceNumberPrefix, profile.invoiceNumberYear, invoices),
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    status: 'Draft',
    paymentTerms: '',
    notes: '',
    discount: 0,
    shipping: 0,
  }
}

const WORKSPACE_STORAGE_KEY = 'cinvoice_workspace_v1'

type LastPdfMeta = {
  objectKey: string
  invoiceNumber: string
  exportedAt: string
}

type StoredWorkspaceV1 = {
  profile?: Partial<CompanyProfile>
  catalog?: CatalogItem[]
  draftLines?: DraftInvoiceLine[]
  clientName?: string
  clientGstHstNumber?: string
  clientId?: string
  meta?: Partial<InvoiceMeta>
  invoices?: InvoiceRecord[]
  clients?: ClientRecord[]
  lastPdf?: LastPdfMeta
}

type LoadedWorkspaceState = {
  profile: CompanyProfile
  catalog: CatalogItem[]
  draftLines: DraftInvoiceLine[]
  clientName: string
  clientGstHstNumber: string
  clientId: string
  meta: InvoiceMeta
  invoices: InvoiceRecord[]
  clients: ClientRecord[]
  lastPdf?: LastPdfMeta
}

function freshWorkspaceFromLegacyProfile(): LoadedWorkspaceState {
  const profile = isCognitoConfigured() ? { ...initialProfile } : readStoredCompanyProfile()
  const emptyInv: InvoiceRecord[] = []
  return {
    profile,
    catalog: [],
    draftLines: [],
    clientName: '',
    clientGstHstNumber: '',
    clientId: '',
    meta: createInvoiceMetaFromProfile(profile, emptyInv),
    invoices: [],
    clients: [],
  }
}

function normalizeWorkspace(parsed: StoredWorkspaceV1): LoadedWorkspaceState {
  const profile: CompanyProfile = { ...initialProfile, ...(parsed.profile ?? {}) }
  const catalog: CatalogItem[] = Array.isArray(parsed.catalog) ? parsed.catalog : []
  const invoices: InvoiceRecord[] = Array.isArray(parsed.invoices) ? parsed.invoices : []
  const clients: ClientRecord[] = Array.isArray(parsed.clients) ? parsed.clients : []
  const draftLines: DraftInvoiceLine[] = Array.isArray(parsed.draftLines)
    ? parsed.draftLines
    : []

  const clientName = typeof parsed.clientName === 'string' ? parsed.clientName : ''
  const clientGstHstNumber =
    typeof parsed.clientGstHstNumber === 'string' ? parsed.clientGstHstNumber : ''

  const seededMeta = createInvoiceMetaFromProfile(profile, invoices)
  const metaPartial = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {}
  const meta: InvoiceMeta = { ...seededMeta, ...metaPartial }

  const lastPdf =
    parsed.lastPdf &&
    typeof parsed.lastPdf === 'object' &&
    typeof (parsed.lastPdf as LastPdfMeta).objectKey === 'string'
      ? (parsed.lastPdf as LastPdfMeta)
      : undefined

  return {
    profile,
    catalog,
    draftLines,
    clientName,
    clientGstHstNumber,
    clientId: typeof parsed.clientId === 'string' ? parsed.clientId : '',
    meta,
    invoices,
    clients,
    lastPdf,
  }
}

function readWorkspaceInitialState(): LoadedWorkspaceState {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return freshWorkspaceFromLegacyProfile()
  }
  if (isCognitoConfigured()) {
    return freshWorkspaceFromLegacyProfile()
  }
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (raw?.trim()) {
      const parsed = JSON.parse(raw) as StoredWorkspaceV1
      if (parsed && typeof parsed === 'object') {
        return normalizeWorkspace(parsed)
      }
    }
  } catch {
    /* invalid JSON */
  }
  return freshWorkspaceFromLegacyProfile()
}

function App() {
  const [workspaceSeed] = useState(() => readWorkspaceInitialState())
  const [profile, setProfile] = useState(workspaceSeed.profile)
  const [catalog, setCatalog] = useState(workspaceSeed.catalog)
  const [draftLines, setDraftLines] = useState(workspaceSeed.draftLines)
  const [clientName, setClientName] = useState(workspaceSeed.clientName)
  const [clientGstHstNumber, setClientGstHstNumber] = useState(workspaceSeed.clientGstHstNumber)
  const [selectedClientId, setSelectedClientId] = useState(workspaceSeed.clientId)
  const [meta, setMeta] = useState(workspaceSeed.meta)
  const [invoices, setInvoices] = useState(workspaceSeed.invoices)
  const [clients, setClients] = useState(workspaceSeed.clients)
  const [lastPdf, setLastPdf] = useState<LastPdfMeta | undefined>(workspaceSeed.lastPdf)
  /** Shared with Create Invoice so after export we can reset auto invoice number. */
  const invoiceNumberEditedRef = useRef(false)

  const location = useLocation()
  const navigate = useNavigate()
  const [authChecked, setAuthChecked] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [workspaceCloudReady, setWorkspaceCloudReady] = useState(
    () => !isApiConfigured() || !isCognitoConfigured(),
  )
  const [authUserDisplay, setAuthUserDisplay] = useState<string | null>(null)
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string | null>(null)

  /** After password sign-in, ignore a late/stale bootstrap `checkSignedIn() === false` (StrictMode / slow network). */
  const userSessionPinnedRef = useRef(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)')
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!mobileNavOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileNavOpen])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await checkSignedIn()
      if (!cancelled) {
        if (!(userSessionPinnedRef.current && !ok)) {
          setAuthed(ok)
        }
        setAuthChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isCognitoConfigured()) return
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedOut') {
        userSessionPinnedRef.current = false
        setAuthed(false)
      }
    })
    return stop
  }, [])

  useEffect(() => {
    if (!authed || !isCognitoConfigured()) {
      setAuthUserDisplay(null)
      return
    }
    let cancelled = false
    void (async () => {
      const label = await getAuthUserDisplay()
      if (!cancelled) setAuthUserDisplay(label)
    })()
    return () => {
      cancelled = true
    }
  }, [authed])

  useEffect(() => {
    if (!authed || !isApiConfigured() || !isCognitoConfigured()) {
      setWorkspaceCloudReady(true)
      return
    }
    let cancelled = false
    setWorkspaceCloudReady(false)
    void (async () => {
      try {
        const remote = await fetchWorkspaceFromAws()
        if (cancelled) return
        const parsed = remote as StoredWorkspaceV1
        const n = normalizeWorkspace(parsed)
        setProfile(n.profile)
        setCatalog(n.catalog)
        setDraftLines(n.draftLines)
        setClientName(n.clientName)
        setClientGstHstNumber(n.clientGstHstNumber)
        setSelectedClientId(n.clientId)
        setMeta(n.meta)
        setInvoices(n.invoices)
        setClients(n.clients)
        setLastPdf(n.lastPdf)
        setWorkspaceSaveError(null)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Workspace cloud load failed'
        console.warn('Workspace cloud load failed', e)
        if (!cancelled) {
          setWorkspaceSaveError(message)
        }
      } finally {
        if (!cancelled) {
          setWorkspaceCloudReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authed])

  const persistWorkspace = useCallback(
    async (snapshotOverride?: StoredWorkspaceV1) => {
      const snapshot: StoredWorkspaceV1 =
        snapshotOverride ??
        {
          profile,
          catalog,
          draftLines,
          clientName,
          clientGstHstNumber,
          clientId: selectedClientId,
          meta,
          invoices,
          clients,
          lastPdf,
        }
      const cloudOk =
        isCognitoConfigured() && isApiConfigured() && authed && workspaceCloudReady
      if (cloudOk) {
        try {
          await putWorkspaceToAws(snapshot as unknown as Record<string, unknown>, { fullSync: true })
          setWorkspaceSaveError(null)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Workspace save failed'
          setWorkspaceSaveError(message)
          throw err
        }
        return
      }
      if (!isCognitoConfigured()) {
        try {
          localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot))
          localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
          setWorkspaceSaveError(null)
        } catch {
          throw new Error('Could not save to browser storage.')
        }
        return
      }
      if (!isApiConfigured()) {
        throw new Error(MISSING_API_GATEWAY_URL)
      }
      if (!workspaceCloudReady) {
        throw new Error('Workspace is still loading. Try again in a moment.')
      }
      if (!authed) {
        throw new Error('Sign in to save.')
      }
      throw new Error('Cannot save workspace right now.')
    },
    [
      authed,
      workspaceCloudReady,
      profile,
      catalog,
      draftLines,
      clientName,
      clientGstHstNumber,
      selectedClientId,
      selectedClientId,
      meta,
      invoices,
      clients,
      lastPdf,
    ],
  )

  const updateInvoices = useCallback(
    async (nextInvoices: InvoiceRecord[]) => {
      setInvoices(nextInvoices)
      await persistWorkspace({
        profile,
        catalog,
        draftLines,
        clientName,
        clientGstHstNumber,
        clientId: selectedClientId,
        meta,
        invoices: nextInvoices,
        clients,
        lastPdf,
      })
    },
    [
      persistWorkspace,
      profile,
      catalog,
      draftLines,
      clientName,
      clientGstHstNumber,
      selectedClientId,
      meta,
      clients,
      lastPdf,
    ],
  )

  const updateCatalog = useCallback(
    async (nextCatalog: CatalogItem[]) => {
      setCatalog(nextCatalog)
      await persistWorkspace({
        profile,
        catalog: nextCatalog,
        draftLines,
        clientName,
        clientGstHstNumber,
        clientId: selectedClientId,
        meta,
        invoices,
        clients,
        lastPdf,
      })
    },
    [
      persistWorkspace,
      profile,
      draftLines,
      clientName,
      clientGstHstNumber,
      selectedClientId,
      meta,
      invoices,
      clients,
      lastPdf,
    ],
  )

  const updateClients = useCallback(
    async (nextClients: ClientRecord[]) => {
      setClients(nextClients)
      await persistWorkspace({
        profile,
        catalog,
        draftLines,
        clientName,
        clientGstHstNumber,
        clientId: selectedClientId,
        meta,
        invoices,
        clients: nextClients,
        lastPdf,
      })
    },
    [
      persistWorkspace,
      profile,
      catalog,
      draftLines,
      clientName,
      clientGstHstNumber,
      selectedClientId,
      meta,
      invoices,
      lastPdf,
    ],
  )

  const handleDeleteInvoice = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      if (isCognitoConfigured() && isApiConfigured()) {
        if (!authed || !workspaceCloudReady) {
          throw new Error('Sign in and wait for workspace to load before deleting an invoice.')
        }
        await deleteInvoiceFromAws(invoiceId, invoiceNumber)
      }
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId))
    },
    [authed, workspaceCloudReady],
  )

  const handleDeleteClient = useCallback(
    async (clientId: string, clientIdConfirm: string) => {
      if (isCognitoConfigured() && isApiConfigured()) {
        if (!authed || !workspaceCloudReady) {
          throw new Error('Sign in and wait for workspace to load before deleting a client.')
        }
        await deleteClientFromAws(clientId, clientIdConfirm)
      }
      setClients((prev) => prev.filter((client) => client.id !== clientId))
      if (selectedClientId === clientId) {
        setSelectedClientId('')
        setClientName('')
        setClientGstHstNumber('')
      }
    },
    [authed, workspaceCloudReady, selectedClientId],
  )

  const workspaceSaveEnabled =
    !isCognitoConfigured() || (Boolean(authed) && workspaceCloudReady && isApiConfigured())

  const workspaceSaveHint =
    workspaceSaveError ??
    (isCognitoConfigured() && !isApiConfigured()
      ? MISSING_API_GATEWAY_URL
      : isCognitoConfigured() && authed && !workspaceCloudReady
        ? 'Loading workspace…'
        : undefined)

  const totals = useMemo(() => {
    const subTotalRaw = draftLines.reduce((acc, line) => acc + line.quantity * line.customPrice, 0)
    const discountedSubTotal = Math.max(0, subTotalRaw - meta.discount)
    const taxByRate = aggregateTaxByRate(draftLines)
    const taxTotal = taxByRate.reduce((acc, row) => acc + row.amount, 0)
    return {
      subTotalRaw,
      subTotal: discountedSubTotal,
      taxTotal,
      taxByRate,
      grandTotal: discountedSubTotal + taxTotal + meta.shipping,
    }
  }, [draftLines, meta.discount, meta.shipping])

  const addCatalogItem = (itemId: number) => {
    const picked = catalog.find((item) => item.id === itemId)
    if (!picked) return

    setDraftLines((prev) => [
      ...prev,
      {
        ...picked,
        quantity: 1,
        customPrice: picked.defaultPrice,
      },
    ])
  }

  const updateLine = (index: number, key: 'quantity' | 'customPrice', value: number) => {
    setDraftLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [key]: Number.isNaN(value) ? 0 : value } : line)),
    )
  }

  const removeLine = (index: number) => {
    setDraftLines((prev) => prev.filter((_, i) => i !== index))
  }

  const exportPdf = async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    const PW = doc.internal.pageSize.getWidth()
    const mL = 14
    const mR = 14
    const W = PW - mL - mR
    const taxBreakdown = totals.taxByRate.filter((t) => t.amount >= 0.005)

    const headerTop = 6
    const headerH = 42
    const docColW = 44
    const docColX = PW - mR - docColW
    const logoBox = 28
    const logoPad = 4
    const logoX = mL + 5
    const addrMaxW = Math.max(44, docColX - logoX - logoBox - 10)

    doc.setFillColor(...PDF_BRAND.headerBg)
    doc.rect(mL, headerTop, W, headerH, 'F')
    doc.setDrawColor(...PDF_BRAND.headerRule)
    doc.setLineWidth(0.28)
    doc.line(mL, headerTop + headerH, mL + W, headerTop + headerH)
    doc.setLineWidth(0.15)
    doc.setDrawColor(...PDF_BRAND.headerRuleHairline)
    doc.line(mL, headerTop + headerH + 1.1, mL + W, headerTop + headerH + 1.1)

    const logoY = headerTop + (headerH - logoBox) / 2
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(...PDF_BRAND.logoBoxStroke)
    doc.roundedRect(logoX, logoY, logoBox, logoBox, 2.4, 2.4, 'FD')

    const logoSource = profile.logoDataUrl || brandLogoPath
    let logoForPdf: { src: string; format: 'PNG' | 'JPEG' } = { src: logoSource, format: 'PNG' }
    try {
      logoForPdf = await prepareLogoForPdf(logoSource)
    } catch {
      logoForPdf = { src: logoSource, format: 'PNG' }
    }
    const innerMax = logoBox - logoPad * 2
    let imgDrawW = innerMax * 0.92
    let imgDrawH = innerMax * 0.92
    try {
      const props = doc.getImageProperties(logoForPdf.src)
      const iw = props.width || innerMax
      const ih = props.height || innerMax
      const s = Math.min(innerMax / iw, innerMax / ih)
      imgDrawW = iw * s
      imgDrawH = ih * s
    } catch {
      /* uniform fallback */
    }
    const logoIx = logoX + (logoBox - imgDrawW) / 2
    const logoIy = logoY + (logoBox - imgDrawH) / 2
    try {
      doc.addImage(logoForPdf.src, logoForPdf.format, logoIx, logoIy, imgDrawW, imgDrawH)
    } catch {
      doc.setTextColor(...PDF_BRAND.headerMuted)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(profile.companyName.slice(0, 3).toUpperCase(), logoX + logoBox / 2, logoY + logoBox / 2 + 2.5, {
        align: 'center',
      })
    }

    const wrapCompanyAddressForPdf = (maxW: number): string[] => {
      const out: string[] = []
      const street = profile.streetAddress.trim()
      const cityLine = [profile.city, profile.province, profile.postalCode]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ')
      if (street) out.push(...doc.splitTextToSize(street, maxW))
      if (cityLine) out.push(...doc.splitTextToSize(cityLine, maxW))
      return out.length ? out : ['']
    }

    const addrLines = wrapCompanyAddressForPdf(addrMaxW)
    const stackGap = 4.75
    const contactRows = 1 + addrLines.length + 3
    const blockSpan = (contactRows - 1) * stackGap + 2.4
    const textX = logoX + logoBox + 6
    const senderBlockNudgeY = 3.2
    const yStart = headerTop + (headerH - blockSpan) / 2 + 1.1 + senderBlockNudgeY

    let yCur = yStart
    doc.setTextColor(...PDF_BRAND.headerInk)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(profile.companyName, textX, yCur)
    yCur += stackGap

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.4)
    doc.setTextColor(...PDF_BRAND.headerMuted)
    addrLines.forEach((line) => {
      doc.text(line, textX, yCur)
      yCur += stackGap
    })

    doc.setTextColor(...PDF_BRAND.headerSoft)
    doc.text(profile.phone, textX, yCur)
    yCur += stackGap
    doc.text(profile.email, textX, yCur)
    yCur += stackGap
    doc.setFontSize(7.2)
    doc.setTextColor(...PDF_BRAND.headerFaint)
    doc.text(`GST/HST registration: ${profile.gstHstNumber}`, textX, yCur)

    const blockTop = yStart - 3.2
    const blockBottom = yCur + 2.4
    const vMid = (blockTop + blockBottom) / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...PDF_BRAND.invoiceTitle)
    const invH = doc.getTextDimensions('INVOICE').h
    const invBaseline = vMid + invH / 2 - 0.8
    doc.text('INVOICE', docColX, invBaseline)

    const secY = headerTop + headerH + 7
    doc.setTextColor(30, 41, 59)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('INVOICE TO', mL + 2, secY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const clientLines = doc.splitTextToSize(clientName, 84)
    doc.text(clientLines, mL + 2, secY + 4.5)
    let clientBottom = secY + 4.5 + clientLines.length * 5 + 1

    const billToClient =
      clients.find((c) => `${c.company} (${c.name})` === clientName.trim()) ??
      (clientGstHstNumber.trim()
        ? clients.find((c) => c.gstHstNumber.trim() === clientGstHstNumber.trim())
        : undefined)
    if (billToClient) {
      const billW = 84
      const addrStep = 4.75
      const street = billToClient.streetAddress.trim()
      const cityLine = [billToClient.city, billToClient.province, billToClient.postalCode]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ')
      doc.setFontSize(9)
      doc.setTextColor(51, 65, 85)
      if (street) {
        for (const line of doc.splitTextToSize(street, billW)) {
          doc.text(line, mL + 2, clientBottom)
          clientBottom += addrStep
        }
      }
      if (cityLine) {
        for (const line of doc.splitTextToSize(cityLine, billW)) {
          doc.text(line, mL + 2, clientBottom)
          clientBottom += addrStep
        }
      }
      const phone = billToClient.phone.trim()
      const email = billToClient.email.trim()
      if (phone || email) {
        doc.setFontSize(8.5)
        doc.setTextColor(71, 85, 105)
        const contactLine = [phone, email].filter(Boolean).join(' · ')
        for (const line of doc.splitTextToSize(contactLine, billW)) {
          doc.text(line, mL + 2, clientBottom)
          clientBottom += addrStep
        }
      }
    }

    if (clientGstHstNumber) {
      doc.setFontSize(8.5)
      doc.setTextColor(71, 85, 105)
      doc.text(`GST/HST: ${clientGstHstNumber}`, mL + 2, clientBottom)
      clientBottom += 4.5
    }

    const metaLeft = 118
    const metaW = PW - mR - metaLeft
    const metaRowH = 6.2
    const metaPad = 2.5
    let my = secY - 0.5
    const metaRows: [string, string][] = [
      ['INVOICE #', meta.invoiceNumber],
      ['ISSUE DATE', meta.issueDate],
      ['DUE DATE', meta.dueDate],
      ['STATUS', meta.status],
    ]
    for (const [lab, val] of metaRows) {
      doc.setFillColor(...PDF_BRAND.metaFill)
      doc.setDrawColor(...PDF_BRAND.metaStroke)
      doc.rect(metaLeft, my, metaW, metaRowH, 'FD')
      doc.setTextColor(71, 85, 105)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(lab, metaLeft + metaPad, my + 4.2)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(15, 23, 42)
      doc.text(val, metaLeft + metaW - metaPad, my + 4.2, { align: 'right' })
      my += metaRowH + 1.8
    }
    const metaBottom = my

    const startY = Math.max(clientBottom + 5, metaBottom + 3)
    const PH = doc.internal.pageSize.getHeight()
    const PAGE_SAFE = PH - 16

    const drawLineItemsHeader = (headerTop: number): number => {
      doc.setFillColor(...PDF_BRAND.tableHeader)
      doc.rect(mL, headerTop, W, 7.5, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.text('DESCRIPTION', mL + 2, headerTop + 5.2)
      doc.text('QTY', mL + 96, headerTop + 5.2)
      doc.text('RATE', mL + 112, headerTop + 5.2)
      doc.text('TAX (HST/GST)', mL + 134, headerTop + 5.2)
      doc.text('AMOUNT', mL + W - 2, headerTop + 5.2, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      return headerTop + 12
    }

    let y = drawLineItemsHeader(startY)
    draftLines.forEach((line) => {
      const amount = line.quantity * line.customPrice
      const rowTax = amount * (line.taxRate / 100)
      const taxBits = doc.splitTextToSize(`$${rowTax.toFixed(2)}\n${taxLabelForRate(line.taxRate)}`, 36)
      const rowH = Math.max(9, taxBits.length * 3.4 + 5)
      if (y + rowH > PAGE_SAFE) {
        doc.addPage()
        y = drawLineItemsHeader(14)
      }
      doc.setTextColor(31, 41, 55)
      doc.setFontSize(9)
      doc.text(line.name, mL + 2, y, { maxWidth: 78 })
      doc.text(`${line.quantity} ${line.unit}`, mL + 96, y)
      doc.text(`$${line.customPrice.toFixed(2)}`, mL + 112, y)
      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)
      doc.text(taxBits, mL + 134, y - 0.5)
      doc.setFontSize(9)
      doc.setTextColor(31, 41, 55)
      doc.text(`$${amount.toFixed(2)}`, mL + W - 2, y, { align: 'right' })
      y += rowH
    })

    const bx = 114
    const bw = PW - mR - bx
    const payR = PW - mR - 2
    const lblX = bx + 3
    const leftColW = Math.max(52, bx - mL - 8)

    const taxRowCount = Math.max(1, taxBreakdown.length)
    const boxH = 8 + 5.5 * (2 + taxRowCount + 1) + 11
    const paymentBlock = buildInvoicePaymentBlock(profile)
    const invoicePaymentFooterH = estimatePaymentFooterHeight(paymentBlock, doc, W - 6)
    const paymentTermsText = meta.paymentTerms.trim()
    const showPaymentTerms = paymentTermsText.length > 0
    const notesText = meta.notes.trim()
    const showNotes = notesText.length > 0
    const termsLines = showPaymentTerms ? doc.splitTextToSize(meta.paymentTerms, leftColW) : []
    const notesLines = showNotes ? doc.splitTextToSize(notesText, leftColW) : []
    const innerPad = 5.5
    const notesBlockH = showNotes ? 5 + notesLines.length * 4.2 : 0
    const paymentTermsBlockH = showPaymentTerms ? 5 + termsLines.length * 4.2 : 0
    const leftBlockH =
      showNotes || showPaymentTerms ? innerPad + notesBlockH + paymentTermsBlockH + 3 : 0
    const pageBottomReserve = 16 + (paymentBlock.hasContent ? invoicePaymentFooterH + 2 : 0)
    const pageSafeWithPayment = PH - pageBottomReserve
    const footerSectionH = Math.max(boxH, leftBlockH) + 6

    if (y + 6 + footerSectionH > pageSafeWithPayment) {
      doc.addPage()
      y = 14
    }
    const sectionTop = y + 6
    const leftTitleY = sectionTop + innerPad

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    if (showNotes) {
      doc.setFont('helvetica', 'bold')
      doc.text('Notes', mL, leftTitleY)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(71, 85, 105)
      doc.text(notesLines, mL, leftTitleY + 5)
    }
    if (showPaymentTerms) {
      const termsHeaderY = showNotes ? leftTitleY + notesBlockH : leftTitleY
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 41, 59)
      doc.text('Payment terms', mL, termsHeaderY)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(71, 85, 105)
      doc.text(termsLines, mL, termsHeaderY + 5)
    }

    doc.setDrawColor(...PDF_BRAND.totalsCardStroke)
    doc.setFillColor(...PDF_BRAND.totalsCardFill)
    doc.roundedRect(bx, sectionTop, bw, boxH, 2, 2, 'FD')

    let ty = sectionTop + 5.5
    const moneyRow = (label: string, val: string) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(55, 65, 85)
      doc.text(label, lblX, ty)
      doc.text(val, payR, ty, { align: 'right' })
      ty += 5.5
    }
    moneyRow('Subtotal (before tax)', `$${totals.subTotalRaw.toFixed(2)}`)
    const discountCell =
      meta.discount > 0 ? `-$${meta.discount.toFixed(2)}` : `$${meta.discount.toFixed(2)}`
    moneyRow('Discount', discountCell)
    if (taxBreakdown.length === 0) {
      moneyRow('Tax', '$0.00')
    } else {
      for (const t of taxBreakdown) {
        moneyRow(t.label, `$${t.amount.toFixed(2)}`)
      }
    }
    moneyRow('Shipping', `$${meta.shipping.toFixed(2)}`)

    doc.setFillColor(...PDF_BRAND.totalBar)
    doc.rect(bx, ty - 0.5, bw, 9, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('TOTAL DUE', lblX, ty + 5.5)
    doc.text(`$${totals.grandTotal.toFixed(2)}`, payR, ty + 5.5, { align: 'right' })

    const footerY = PH - 8
    const totalPages = doc.getNumberOfPages()
    const paymentBoxTop = PH - 14 - invoicePaymentFooterH
    const paymentFooterLines = buildPaymentFooterLines(paymentBlock)
    const paymentInnerW = W - 6

    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p)
      if (p === totalPages && paymentBlock.hasContent) {
        doc.setDrawColor(...PDF_BRAND.metaStroke)
        doc.setFillColor(...PDF_BRAND.metaFill)
        doc.roundedRect(mL, paymentBoxTop, W, invoicePaymentFooterH, 2, 2, 'FD')

        let py = paymentBoxTop + 5
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(30, 41, 59)
        doc.text('PAYMENT INFORMATION', mL + 3, py)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(100, 116, 130)
        doc.text(`Ref: ${meta.invoiceNumber}`, mL + W - 3, py, { align: 'right' })
        py += 4

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(55, 65, 85)
        for (const line of paymentFooterLines) {
          for (const wrapped of doc.splitTextToSize(line, paymentInnerW)) {
            doc.text(wrapped, mL + 3, py)
            py += 3.2
          }
        }
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      doc.text(`Page ${p} of ${totalPages}`, PW - mR, footerY, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(100, 116, 130)
      doc.text(APP_BRAND, mL, footerY)
    }

    const pdfBlob = doc.output('blob')
    doc.save(`${meta.invoiceNumber}.pdf`)
    const invoiceKey = meta.invoiceNumber.replace(/[^\w.-]+/g, '_').slice(0, 120)
    let objectKey: string | null = null
    try {
      objectKey = await uploadInvoicePdfToS3IfConfigured(pdfBlob, invoiceKey || `inv-${Date.now()}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF cloud upload failed'
      console.warn('Invoice PDF S3 upload failed (invoice will still be saved to the workspace):', err)
      setWorkspaceSaveError(`PDF not saved to cloud: ${msg}. Check browser console (often S3 CORS).`)
    }

    const nextLastPdf: LastPdfMeta | undefined = objectKey
      ? {
          objectKey,
          invoiceNumber: meta.invoiceNumber,
          exportedAt: new Date().toISOString(),
        }
      : lastPdf

    const statusForRow: InvoiceRecord['status'] =
      meta.status === 'Draft' ? 'Open' : (meta.status as InvoiceRecord['status'])

    const invoiceLines = draftLines.map((line) => ({
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      price: line.customPrice,
      taxRate: line.taxRate,
    }))

    const newRecord: InvoiceRecord = {
      id: `inv-${Date.now()}`,
      invoiceNumber: meta.invoiceNumber.trim(),
      clientId: selectedClientId || undefined,
      client: clientName.trim() || 'Client',
      issueDate: meta.issueDate,
      dueDate: meta.dueDate,
      totalAmount: Math.round(totals.grandTotal * 100) / 100,
      subtotal: Math.round(totals.subTotal * 100) / 100,
      tax: Math.round(totals.taxTotal * 100) / 100,
      paidAmount: 0,
      status: statusForRow,
      lines: invoiceLines,
      ...(objectKey ? { pdfObjectKey: objectKey } : {}),
    }

    const nextInvoices = [...invoices, newRecord]
    const nextMeta = createInvoiceMetaFromProfile(profile, nextInvoices)

    const snapshot: StoredWorkspaceV1 = {
      profile,
      catalog,
      draftLines: [],
      clientName,
      clientGstHstNumber,
      clientId: selectedClientId,
      meta: nextMeta,
      invoices: nextInvoices,
      clients,
      lastPdf: nextLastPdf,
    }

    if (isCognitoConfigured()) {
      if (!isApiConfigured()) {
        throw new Error(MISSING_API_GATEWAY_URL)
      }
      if (!authed || !workspaceCloudReady) {
        throw new Error('Sign in and wait for workspace to load before recording an invoice.')
      }
      await putWorkspaceToAws(snapshot as unknown as Record<string, unknown>)
    } else {
      try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot))
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
      } catch {
        throw new Error('Could not save to browser storage.')
      }
    }

    setInvoices(nextInvoices)
    setLastPdf(nextLastPdf)
    setDraftLines([])
    setMeta(nextMeta)
    invoiceNumberEditedRef.current = false
  }

  if (!authChecked) {
    return <div className="auth-loading">Loading…</div>
  }

  if (!authed) {
    if (location.pathname !== '/login') {
      return <Navigate to="/login" replace />
    }
    return <LoginPage onSignedIn={() => { userSessionPinnedRef.current = true; setAuthed(true) }} />
  }
  if (location.pathname === '/login') {
    return <Navigate to="/" replace />
  }

  if (!workspaceCloudReady) {
    return <div className="auth-loading">Loading workspace…</div>
  }

  return (
    <div className={`app-shell${mobileNavOpen ? ' app-shell--nav-open' : ''}`}>
      {isCognitoConfigured() && authed && (
        <header className="app-topbar app-topbar--desktop">
          <div className="app-topbar-inner">
            <span className="app-user-display" title={authUserDisplay ?? undefined}>
              {authUserDisplay ?? '…'}
            </span>
            <button
              type="button"
              className="ghost app-signout-btn"
              onClick={() => {
                void (async () => {
                  await signOutUser()
                  userSessionPinnedRef.current = false
                  setAuthed(false)
                  setAuthUserDisplay(null)
                  navigate('/login', { replace: true })
                })()
              }}
            >
              Sign out
            </button>
          </div>
        </header>
      )}

      <header className="app-mobile-header">
        <button
          type="button"
          className="icon-btn mobile-nav-toggle"
          aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <UiIcon name={mobileNavOpen ? 'close' : 'menu'} />
        </button>
        <span className="app-mobile-brand">{APP_BRAND}</span>
        {isCognitoConfigured() && authed ? (
          <div className="app-mobile-header-actions">
            <span className="app-user-display" title={authUserDisplay ?? undefined}>
              {authUserDisplay ?? '…'}
            </span>
            <button
              type="button"
              className="ghost app-signout-btn app-signout-btn--compact"
              onClick={() => {
                void (async () => {
                  await signOutUser()
                  userSessionPinnedRef.current = false
                  setAuthed(false)
                  setAuthUserDisplay(null)
                  setMobileNavOpen(false)
                  navigate('/login', { replace: true })
                })()
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </header>

      {mobileNavOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside className="sidebar">
        <div className="sidebar-mobile-toolbar">
          <div className="brand sidebar-brand-compact">
            <span className="brand-badge brand-logo-box">
              <img src={brandLogoPath} alt={`${APP_BRAND} logo`} className="brand-logo" />
            </span>
            <div>
              <h1>{APP_BRAND}</h1>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-close-btn"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          >
            <UiIcon name="close" />
          </button>
        </div>
        <div className="brand sidebar-brand-desktop">
          <span className="brand-badge brand-logo-box">
            <img src={brandLogoPath} alt={`${APP_BRAND} logo`} className="brand-logo" />
          </span>
          <div>
            <h1>{APP_BRAND}</h1>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end onClick={() => setMobileNavOpen(false)}>
            Dashboard
          </NavLink>
          <NavLink to="/catalog" onClick={() => setMobileNavOpen(false)}>
            Items & Services
          </NavLink>
          <NavLink to="/create-invoice" onClick={() => setMobileNavOpen(false)}>
            Create Invoice
          </NavLink>
          <NavLink to="/invoices" onClick={() => setMobileNavOpen(false)}>
            Invoices
          </NavLink>
          <NavLink to="/clients" onClick={() => setMobileNavOpen(false)}>
            Clients
          </NavLink>
          <NavLink to="/company" onClick={() => setMobileNavOpen(false)}>
            Settings
          </NavLink>
        </nav>
      </aside>

      <main className="content">
        <div className="page-wrap">
          <Routes>
            <Route path="/" element={<Dashboard invoices={invoices} />} />
            <Route
              path="/company"
              element={
                <CompanyPage
                  profile={profile}
                  onChange={setProfile}
                  onSaveWorkspace={persistWorkspace}
                  saveEnabled={workspaceSaveEnabled}
                  saveHint={workspaceSaveHint}
                  passwordChangeEnabled={isCognitoConfigured() && Boolean(authed)}
                />
              }
            />
            <Route path="/catalog" element={<CatalogPage catalog={catalog} onUpdateCatalog={updateCatalog} />} />
            <Route
              path="/create-invoice"
              element={
                <CreateInvoicePage
                  clientName={clientName}
                  setClientName={setClientName}
                  clientGstHstNumber={clientGstHstNumber}
                  setClientGstHstNumber={setClientGstHstNumber}
                  selectedClientId={selectedClientId}
                  setSelectedClientId={setSelectedClientId}
                  clients={clients}
                  onUpdateClients={updateClients}
                  profile={profile}
                  invoices={invoices}
                  meta={meta}
                  setMeta={setMeta}
                  catalog={catalog}
                  addCatalogItem={addCatalogItem}
                  draftLines={draftLines}
                  updateLine={updateLine}
                  removeLine={removeLine}
                  totals={totals}
                  exportPdf={exportPdf}
                  invoiceNumberEditedRef={invoiceNumberEditedRef}
                />
              }
            />
            <Route
              path="/invoices"
              element={
                <InvoicesPage
                  invoices={invoices}
                  onUpdateInvoices={updateInvoices}
                  onDeleteInvoice={handleDeleteInvoice}
                />
              }
            />
            <Route path="/clients" element={<ClientsPage clients={clients} onUpdateClients={updateClients} onDeleteClient={handleDeleteClient} />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function Dashboard({ invoices }: { invoices: InvoiceRecord[] }) {
  const navigate = useNavigate()
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const [chartPeriod, setChartPeriod] = useState<DashboardChartPeriod>('6month')

  const sortedByIssue = useMemo(
    () => [...invoices].sort((a, b) => parseIssueDateMs(b.issueDate) - parseIssueDateMs(a.issueDate)),
    [invoices],
  )

  const totalBilled = useMemo(() => invoices.reduce((a, i) => a + i.totalAmount, 0), [invoices])
  const totalPaid = useMemo(() => invoices.reduce((a, i) => a + i.paidAmount, 0), [invoices])
  const totalTax = useMemo(() => invoices.reduce((a, i) => a + invoiceTaxAmount(i), 0), [invoices])
  const pendingReceivables = useMemo(
    () => invoices.reduce((a, i) => a + Math.max(0, i.totalAmount - i.paidAmount), 0),
    [invoices],
  )
  const openInvoiceCount = useMemo(
    () => invoices.filter((i) => i.status === 'Open' || i.status === 'Partial' || i.status === 'Overdue').length,
    [invoices],
  )

  const issuedToday = useMemo(
    () => invoices.filter((i) => i.issueDate === todayStr).reduce((a, i) => a + i.totalAmount, 0),
    [invoices, todayStr],
  )

  const chartBuckets = useMemo(
    () => buildDashboardBuckets(invoices, chartPeriod, now),
    [invoices, chartPeriod, now],
  )
  const maxChartValue = useMemo(
    () => Math.max(...chartBuckets.map((b) => Math.max(b.billed, b.paid)), 1),
    [chartBuckets],
  )
  const periodBilled = useMemo(() => chartBuckets.reduce((a, b) => a + b.billed, 0), [chartBuckets])
  const periodPaid = useMemo(() => chartBuckets.reduce((a, b) => a + b.paid, 0), [chartBuckets])
  const periodTax = useMemo(() => chartBuckets.reduce((a, b) => a + b.tax, 0), [chartBuckets])

  const collectionRate =
    totalBilled > 0 ? `${Math.round((totalPaid / totalBilled) * 1000) / 10}%` : '—'

  const overdueExposure = useMemo(
    () =>
      invoices
        .filter((i) => i.status === 'Overdue')
        .reduce((a, i) => a + Math.max(0, i.totalAmount - i.paidAmount), 0),
    [invoices],
  )

  const recentRows = useMemo(
    () =>
      sortedByIssue.slice(0, 8).map((inv) => ({
        no: inv.invoiceNumber,
        client: inv.client,
        status: inv.status,
        due: inv.dueDate,
        amount: formatUsd(inv.totalAmount),
        pending: formatUsd(Math.max(0, inv.totalAmount - inv.paidAmount)),
      })),
    [sortedByIssue],
  )

  const hasData = invoices.length > 0
  const periodLabels: Record<DashboardChartPeriod, string> = {
    week: 'Last 7 days',
    month: 'Last 4 weeks',
    '6month': 'Last 6 months',
    year: 'Last 12 months',
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Tax, collections, and receivables with period-based revenue charts.</p>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => navigate('/create-invoice')}>
            New Invoice
          </button>
        </div>
      </div>

      <div className="stats-grid dashboard-finance-grid">
        <article className="card kpi-card">
          <p className="muted">Total billed</p>
          <h3>{formatUsd(totalBilled)}</h3>
          <p className="tiny">{hasData ? `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} all time` : 'No invoices yet'}</p>
        </article>
        <article className="card kpi-card">
          <p className="muted">Payments received</p>
          <h3 className="kpi-up">{formatUsd(totalPaid)}</h3>
          <p className="tiny">Collection rate {collectionRate}</p>
        </article>
        <article className="card kpi-card">
          <p className="muted">Pending receivables</p>
          <h3 className="danger">{formatUsd(pendingReceivables)}</h3>
          <p className="tiny">{openInvoiceCount} open / partial / overdue</p>
        </article>
        <article className="card kpi-card">
          <p className="muted">Total HST/GST</p>
          <h3>{formatUsd(totalTax)}</h3>
          <p className="tiny">Tax on issued invoice totals</p>
        </article>
      </div>

      <div className="split-grid">
        <div className="card">
          <div className="dashboard-panel-head">
            <h3>Revenue &amp; collections</h3>
            <div className="dashboard-period-tabs" role="tablist" aria-label="Chart period">
              {(
                [
                  ['week', 'Weekly'],
                  ['month', 'Monthly'],
                  ['6month', '6 months'],
                  ['year', 'Yearly'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={chartPeriod === key}
                  className={`dashboard-period-tab ${chartPeriod === key ? 'active' : ''}`}
                  onClick={() => setChartPeriod(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted dashboard-period-caption">{periodLabels[chartPeriod]}</p>
          <div className="dashboard-chart-legend">
            <span><i className="legend-dot legend-billed" /> Billed</span>
            <span><i className="legend-dot legend-paid" /> Received</span>
          </div>
          <div className="bars dashboard-dual-bars">
            {chartBuckets.map((bucket, i) => (
              <div key={`${bucket.label}-${i}`} className="bar-wrap">
                <div className="bar-group">
                  <div
                    className="bar bar-billed"
                    title={`Billed ${formatUsd(bucket.billed)}`}
                    style={{ height: `${Math.max(4, Math.round((bucket.billed / maxChartValue) * 88))}px` }}
                  />
                  <div
                    className="bar bar-paid"
                    title={`Received ${formatUsd(bucket.paid)}`}
                    style={{ height: `${Math.max(4, Math.round((bucket.paid / maxChartValue) * 88))}px` }}
                  />
                </div>
                <span>{bucket.label}</span>
              </div>
            ))}
          </div>
          <div className="dashboard-period-summary">
            <span>Billed {formatUsd(periodBilled)}</span>
            <span>Received {formatUsd(periodPaid)}</span>
            <span>Tax {formatUsd(periodTax)}</span>
          </div>
        </div>
        <div className="card">
          <div className="dashboard-panel-head">
            <h3>Collections snapshot</h3>
            <span className="mini-trend">Today {formatUsd(issuedToday)}</span>
          </div>
          <div className="kpi-list">
            <div className="kpi-row">
              <span>Collection rate</span>
              <strong>{collectionRate}</strong>
            </div>
            <div className="kpi-row">
              <span>Overdue exposure</span>
              <strong className="danger">{formatUsd(overdueExposure)}</strong>
            </div>
            <div className="kpi-row">
              <span>Pending payments</span>
              <strong>{formatUsd(pendingReceivables)}</strong>
            </div>
            <div className="kpi-row">
              <span>Tax in selected period</span>
              <strong>{formatUsd(periodTax)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card data-grid">
        <div className="page-head">
          <h3>Recent invoices</h3>
          <button
            type="button"
            className="icon-btn"
            title="View all invoices"
            aria-label="View all invoices"
            onClick={() => navigate('/invoices')}
          >
            <UiIcon name="view" />
          </button>
        </div>
        <div className="invoice-table mobile-stack-table">
          <div className="invoice-table-head dashboard-invoice-grid dashboard-invoice-grid-ext">
            <span>Invoice</span>
            <span>Client</span>
            <span>Status</span>
            <span>Due Date</span>
            <span>Amount</span>
            <span>Pending</span>
          </div>
          {recentRows.length === 0 ? (
            <p className="muted" style={{ padding: '1rem 0.5rem' }}>
              No invoices yet. Use New Invoice to add your first record.
            </p>
          ) : (
            recentRows.map((invoice) => (
              <div key={invoice.no} className="invoice-table-row dashboard-invoice-grid dashboard-invoice-grid-ext mobile-stack-row">
                <span data-label="Invoice">{invoice.no}</span>
                <span data-label="Client">{invoice.client}</span>
                <span data-label="Status" className={`status-chip status-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                <span data-label="Due">{invoice.due}</span>
                <strong data-label="Amount">{invoice.amount}</strong>
                <span data-label="Pending" className="danger">{invoice.pending}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function CompanyPage({
  profile,
  onChange,
  onSaveWorkspace,
  saveEnabled,
  saveHint,
  passwordChangeEnabled,
}: {
  profile: CompanyProfile
  onChange: (profile: CompanyProfile) => void
  onSaveWorkspace: () => Promise<void>
  saveEnabled: boolean
  saveHint?: string
  passwordChangeEnabled: boolean
}) {
  const MAX_LOGO_UPLOAD_BYTES = 2_000_000
  const setValue = (key: keyof CompanyProfile, value: string) => {
    onChange({ ...profile, [key]: value })
  }
  const onLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > MAX_LOGO_UPLOAD_BYTES) {
      setLogoUploadMsg('Logo is too large. Please upload an image up to 2 MB.')
      event.target.value = ''
      return
    }
    setLogoUploadMsg(null)
    void (async () => {
      try {
        const rawDataUrl = await readFileAsDataUrl(file)
        const normalizedDataUrl = await convertImageToPngDataUrl(rawDataUrl, 640)
        onChange({ ...profile, logoDataUrl: normalizedDataUrl })
        setLogoUploadMsg('Logo prepared and ready to save.')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Logo upload failed.'
        setLogoUploadMsg(message)
      } finally {
        event.target.value = ''
      }
    })()
  }
  const [activeTab, setActiveTab] = useState<'general' | 'payment' | 'security'>('general')
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [stripeSecretDraft, setStripeSecretDraft] = useState('')
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false)
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null)
  const [workspaceSaveBusy, setWorkspaceSaveBusy] = useState(false)
  const [workspaceSaveMsg, setWorkspaceSaveMsg] = useState<string | null>(null)
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false)
  const [passwordChangeMsg, setPasswordChangeMsg] = useState<string | null>(null)
  const [logoUploadMsg, setLogoUploadMsg] = useState<string | null>(null)

  const handleSaveWorkspace = () => {
    setWorkspaceSaveMsg(null)
    setWorkspaceSaveBusy(true)
    void (async () => {
      try {
        await onSaveWorkspace()
        setWorkspaceSaveMsg('Saved.')
      } catch (e) {
        setWorkspaceSaveMsg(e instanceof Error ? e.message : 'Save failed')
      } finally {
        setWorkspaceSaveBusy(false)
      }
    })()
  }

  const handlePasswordChange = () => {
    setPasswordChangeMsg(null)
    const current = passwordForm.currentPassword
    const next = passwordForm.newPassword
    const confirm = passwordForm.confirmPassword
    if (!passwordChangeEnabled) {
      setPasswordChangeMsg('Sign in with your cloud account to change password.')
      return
    }
    if (!current || !next || !confirm) {
      setPasswordChangeMsg('Fill in all password fields.')
      return
    }
    if (next !== confirm) {
      setPasswordChangeMsg('New password and confirmation do not match.')
      return
    }
    if (!isStrongPassword(next)) {
      setPasswordChangeMsg('Use at least 8 characters with uppercase, number, and symbol.')
      return
    }
    setPasswordChangeBusy(true)
    void (async () => {
      try {
        await changeUserPassword(current, next)
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
        setPasswordChangeMsg('Password updated.')
      } catch (err) {
        setPasswordChangeMsg(err instanceof Error ? err.message : 'Password change failed.')
      } finally {
        setPasswordChangeBusy(false)
      }
    })()
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p className="muted">Manage company profile, payout setup, Stripe connection, and security preferences.</p>
        </div>
        <div className="company-save-actions">
          <button
            type="button"
            className="primary"
            disabled={!saveEnabled || workspaceSaveBusy}
            onClick={handleSaveWorkspace}
          >
            {workspaceSaveBusy ? 'Saving…' : 'Save'}
          </button>
          {(workspaceSaveMsg || saveHint) && (
            <p className="muted company-save-feedback" role="status">
              {workspaceSaveMsg ?? saveHint}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="company-tabs" role="tablist" aria-label="Company billing tabs">
          <button
            type="button"
            className={`company-tab ${activeTab === 'general' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'general'}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            type="button"
            className={`company-tab ${activeTab === 'payment' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'payment'}
            onClick={() => setActiveTab('payment')}
          >
            Payment Information
          </button>
          <button
            type="button"
            className={`company-tab ${activeTab === 'security' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'security'}
            onClick={() => setActiveTab('security')}
          >
            Password Change
          </button>
        </div>

        {activeTab === 'general' && (
          <div className="group-box-stack">
            <div className="group-box-grid">
              <fieldset className="group-box">
                <legend>Company details</legend>
                <div className="form-grid two-col-simple">
                  <label>
                    Company Name
                    <input value={profile.companyName} onChange={(e) => setValue('companyName', e.target.value)} />
                  </label>
                  <label>
                    Owner Name
                    <input value={profile.ownerName} onChange={(e) => setValue('ownerName', e.target.value)} />
                  </label>
                  <label>
                    Email
                    <input value={profile.email} onChange={(e) => setValue('email', e.target.value)} />
                  </label>
                  <label>
                    Phone
                    <input value={profile.phone} onChange={(e) => setValue('phone', e.target.value)} />
                  </label>
                  <label>
                    GST/HST Number
                    <input value={profile.gstHstNumber} onChange={(e) => setValue('gstHstNumber', e.target.value)} />
                  </label>
                  <label>
                    Business registration ID
                    <input placeholder="Optional registry identifier" />
                  </label>
                </div>
              </fieldset>

              <fieldset className="group-box">
                <legend>Address</legend>
                <div className="form-grid two-col-simple">
                  <label>
                    Street address
                    <input
                      value={profile.streetAddress}
                      onChange={(e) => setValue('streetAddress', e.target.value)}
                      placeholder="Street address"
                    />
                  </label>
                  <label>
                    City
                    <input value={profile.city} onChange={(e) => setValue('city', e.target.value)} placeholder="City" />
                  </label>
                  <label>
                    Province / state
                    <select value={profile.province} onChange={(e) => setValue('province', e.target.value)}>
                      {CANADA_PROVINCES.map((province) => (
                        <option key={province} value={province}>
                          {province}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Postal code
                    <input
                      value={profile.postalCode}
                      onChange={(e) => setValue('postalCode', normalizeCanadianPostalCode(e.target.value))}
                      placeholder="A1A 1A1"
                      maxLength={7}
                    />
                  </label>
                  <label>
                    Country
                    <input value="Canada" readOnly />
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="group-box-grid">
              <fieldset className="group-box">
                <legend>Invoice defaults</legend>
                <div className="form-grid two-col-simple">
                  <label>
                    Preferred invoice language
                    <select defaultValue="English">
                      <option>English</option>
                      <option>French</option>
                    </select>
                  </label>
                  <label>
                    Invoice number prefix
                    <input
                      value={profile.invoiceNumberPrefix}
                      onChange={(e) => setValue('invoiceNumberPrefix', e.target.value)}
                      placeholder="INV"
                    />
                  </label>
                  <label>
                    Invoice year
                    <input
                      value={profile.invoiceNumberYear}
                      onChange={(e) => setValue('invoiceNumberYear', e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder={new Date().getFullYear().toString()}
                      inputMode="numeric"
                    />
                    <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                      Four digits (e.g. 2026). If empty, the current calendar year is used.
                    </span>
                  </label>
                  <label className="invoice-field-span">
                    Internal billing note
                    <input placeholder="Short note shown only to your team" />
                  </label>
                </div>
              </fieldset>

              <fieldset className="group-box">
                <legend>Company logo</legend>
                <p className="muted">Upload PNG/JPG/WEBP logo; it is resized and saved as PNG for stable PDF output.</p>
                <div className="row" style={{ marginTop: '0.6rem' }}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoUpload} />
                </div>
                {logoUploadMsg && (
                  <p className="muted" style={{ marginTop: 8 }}>
                    {logoUploadMsg}
                  </p>
                )}
                <div className="prefix-logo-preview">
                  <img src={profile.logoDataUrl || brandLogoPath} alt="Company logo preview" />
                </div>
              </fieldset>
            </div>
          </div>
        )}

        {activeTab === 'payment' && (
          <div className="group-box-stack">
            <div className="group-box-grid">
              <fieldset className="group-box">
                <legend>Canadian bank account (EFT)</legend>
                <p className="muted payment-field-help">
                  Standard Canadian routing: 3-digit institution number, 5-digit transit (branch), then account number.
                </p>
                <div className="form-grid two-col-simple">
                  <label>
                    Account holder name
                    <input
                      value={profile.paymentAccountName}
                      onChange={(e) => setValue('paymentAccountName', e.target.value)}
                      placeholder="Legal name on the account"
                    />
                  </label>
                  <label>
                    Financial institution
                    <input
                      value={profile.paymentInstitutionName}
                      onChange={(e) => setValue('paymentInstitutionName', e.target.value)}
                      placeholder="e.g. RBC, TD, Scotiabank"
                    />
                  </label>
                  <label>
                    Institution number
                    <input
                      inputMode="numeric"
                      value={profile.paymentInstitutionNumber}
                      onChange={(e) => setValue('paymentInstitutionNumber', e.target.value.replace(/\D/g, '').slice(0, 3))}
                      placeholder="001"
                      maxLength={3}
                    />
                  </label>
                  <label>
                    Transit number
                    <input
                      inputMode="numeric"
                      value={profile.paymentTransitNumber}
                      onChange={(e) => setValue('paymentTransitNumber', e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="12345"
                      maxLength={5}
                    />
                  </label>
                  <label className="invoice-field-span">
                    Account number
                    <input
                      inputMode="numeric"
                      value={profile.paymentAccountNumber}
                      onChange={(e) => setValue('paymentAccountNumber', e.target.value.replace(/\D/g, '').slice(0, 12))}
                      placeholder="7–12 digits"
                      maxLength={12}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="group-box">
                <legend>Interac e-Transfer</legend>
                <p className="muted payment-field-help">
                  Email used for Interac e-Transfer payments (shown on invoices and client payment instructions).
                </p>
                <div className="form-grid two-col-simple">
                  <label className="invoice-field-span">
                    e-Transfer email
                    <input
                      type="email"
                      value={profile.paymentEmail}
                      onChange={(e) => setValue('paymentEmail', e.target.value)}
                      placeholder="payments@company.com"
                    />
                  </label>
                </div>
                {(profile.paymentInstitutionNumber || profile.paymentTransitNumber || profile.paymentAccountNumber || profile.paymentEmail) && (
                  <div className="payment-preview card-lite">
                    <strong>Payment preview</strong>
                    {profile.paymentInstitutionNumber && profile.paymentTransitNumber && profile.paymentAccountNumber ? (
                      <p>
                        EFT: {profile.paymentInstitutionNumber}-{profile.paymentTransitNumber}-{profile.paymentAccountNumber}
                        {profile.paymentInstitutionName ? ` · ${profile.paymentInstitutionName}` : ''}
                      </p>
                    ) : null}
                    {profile.paymentEmail ? <p>Interac e-Transfer: {profile.paymentEmail}</p> : null}
                  </div>
                )}
              </fieldset>

              <fieldset className="group-box">
                <legend>Stripe keys</legend>
                <div className="form-grid two-col-simple">
                  <label>
                    Stripe account ID
                    <input
                      value={profile.stripeAccountId}
                      onChange={(e) => setValue('stripeAccountId', e.target.value)}
                      placeholder="acct_..."
                    />
                  </label>
                  <label>
                    Stripe publishable key
                    <input
                      value={profile.stripePublishableKey}
                      onChange={(e) => setValue('stripePublishableKey', e.target.value)}
                      placeholder="pk_live_..."
                    />
                  </label>
                  <label className="invoice-field-span">
                    Stripe webhook secret
                    <input
                      value={profile.stripeWebhookSecret}
                      onChange={(e) => setValue('stripeWebhookSecret', e.target.value)}
                      placeholder="whsec_..."
                    />
                  </label>
                  {isApiConfigured() && (
                    <div className="invoice-field-span" style={{ marginTop: 12 }}>
                      <p className="muted" style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.45 }}>
                        When this app can reach your API Gateway, the button below writes Stripe secrets to the server.
                        The secret key field is only sent on that request and is not stored in the browser afterward.
                      </p>
                      <label>
                        Stripe secret key (optional, server only)
                        <input
                          type="password"
                          autoComplete="off"
                          value={stripeSecretDraft}
                          onChange={(e) => setStripeSecretDraft(e.target.value)}
                          placeholder="sk_live_... or sk_test_..."
                        />
                      </label>
                      <div className="row" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="primary"
                          disabled={
                            cloudSyncBusy ||
                            (!stripeSecretDraft.trim() && !profile.stripeWebhookSecret?.trim())
                          }
                          onClick={async () => {
                            setCloudSyncBusy(true)
                            setCloudSyncMsg(null)
                            try {
                              await putStripeSettingsToAws({
                                stripeSecretKey: stripeSecretDraft || undefined,
                                stripeWebhookSecret: profile.stripeWebhookSecret,
                              })
                              setCloudSyncMsg('Stripe settings saved on the server.')
                              setStripeSecretDraft('')
                            } catch (e) {
                              setCloudSyncMsg(e instanceof Error ? e.message : 'Sync failed')
                            } finally {
                              setCloudSyncBusy(false)
                            }
                          }}
                        >
                          {cloudSyncBusy ? 'Saving…' : 'Save Stripe settings to server'}
                        </button>
                      </div>
                      {cloudSyncMsg && (
                        <p className="muted" style={{ marginTop: 8 }}>
                          {cloudSyncMsg}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </fieldset>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="group-box-stack">
            <fieldset className="group-box security-group-box">
              <legend>Password change</legend>
              <div className="security-password-stack">
                <label>
                  Current password
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                    placeholder="Current password"
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                    placeholder="New password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm new password"
                  />
                </label>
                <div className="kpi-row">
                  <span>Password strength rule</span>
                  <strong>Min 8 chars, uppercase, number, symbol</strong>
                </div>
                {!passwordChangeEnabled && (
                  <p className="muted">Sign in to change your account password.</p>
                )}
                {passwordChangeMsg && (
                  <p className={passwordChangeMsg === 'Password updated.' ? 'muted' : 'danger'} role="status">
                    {passwordChangeMsg}
                  </p>
                )}
                <div className="editor-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={!passwordChangeEnabled || passwordChangeBusy}
                    onClick={handlePasswordChange}
                  >
                    {passwordChangeBusy ? 'Updating…' : 'Update password'}
                  </button>
                </div>
              </div>
            </fieldset>
          </div>
        )}
      </div>

      {activeTab === 'general' && (
        <>
          <div className="card">
            <h3>Quick Compliance Check</h3>
            <div className="kpi-list">
              <div className="kpi-row">
                <span>Business details complete</span>
                <strong>
                  {profile.companyName && profile.email && profile.streetAddress.trim() && profile.city.trim()
                    ? 'Ready'
                    : 'Missing'}
                </strong>
              </div>
              <div className="kpi-row">
                <span>GST/HST number set</span>
                <strong>{profile.gstHstNumber ? 'Ready' : 'Missing'}</strong>
              </div>
              <div className="kpi-row">
                <span>Brand logo set</span>
                <strong>{profile.logoDataUrl ? 'Ready' : 'Optional'}</strong>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function CatalogPage({
  catalog,
  onUpdateCatalog,
}: {
  catalog: CatalogItem[]
  onUpdateCatalog: (items: CatalogItem[]) => Promise<void>
}) {
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [newItem, setNewItem] = useState({
    name: '',
    defaultPrice: 0,
    type: 'Service' as CatalogItem['type'],
    unit: 'Hour' as CatalogItem['unit'],
    taxRate: 13,
  })
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    type: 'Service' as CatalogItem['type'],
    unit: 'Hour' as CatalogItem['unit'],
    defaultPrice: 0,
    taxRate: 13,
  })

  const saveNewItem = () => {
    if (!newItem.name.trim() || catalogBusy) return
    const next: CatalogItem = {
      id: Date.now(),
      type: newItem.type,
      name: newItem.name.trim(),
      unit: newItem.unit,
      defaultPrice: newItem.defaultPrice,
      taxRate: newItem.taxRate,
    }
    setCatalogBusy(true)
    setCatalogError(null)
    void (async () => {
      try {
        await onUpdateCatalog([...catalog, next])
        setShowAddItemModal(false)
        setNewItem({
          name: '',
          defaultPrice: 0,
          type: 'Service',
          unit: 'Hour',
          taxRate: 13,
        })
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : 'Could not save catalog item')
      } finally {
        setCatalogBusy(false)
      }
    })()
  }

  const filteredCatalog = catalog.filter((item) =>
    `${item.name} ${item.type} ${item.unit}`.toLowerCase().includes(search.toLowerCase()),
  )

  const startEdit = (item: CatalogItem) => {
    setEditingId(item.id)
    setEditForm({
      name: item.name,
      type: item.type,
      unit: item.unit,
      defaultPrice: item.defaultPrice,
      taxRate: item.taxRate,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = () => {
    if (!editingId || !editForm.name.trim() || catalogBusy) return
    const updated = catalog.map((item) =>
      item.id === editingId
        ? {
            ...item,
            name: editForm.name.trim(),
            type: editForm.type,
            unit: editForm.unit,
            defaultPrice: editForm.defaultPrice,
            taxRate: editForm.taxRate,
          }
        : item,
    )
    setCatalogBusy(true)
    setCatalogError(null)
    void (async () => {
      try {
        await onUpdateCatalog(updated)
        setEditingId(null)
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : 'Could not update catalog item')
      } finally {
        setCatalogBusy(false)
      }
    })()
  }

  const deleteItem = (itemId: number) => {
    if (catalogBusy) return
    const updated = catalog.filter((item) => item.id !== itemId)
    setCatalogBusy(true)
    setCatalogError(null)
    void (async () => {
      try {
        await onUpdateCatalog(updated)
        if (editingId === itemId) {
          setEditingId(null)
        }
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : 'Could not delete catalog item')
      } finally {
        setCatalogBusy(false)
      }
    })()
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Items & Services Library</h2>
          <p className="muted">Reusable price catalog for faster invoice drafting and fewer input errors.</p>
        </div>
      </div>

      {catalogError && (
        <p className="danger" role="alert" style={{ marginBottom: '0.75rem' }}>
          {catalogError}
        </p>
      )}

      <div className="table-toolbar">
        <div className="search-box compact">
          <span className="search-icon">
            <UiIcon name="search" />
          </span>
          <input placeholder="Search in catalog" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="table-toolbar-actions">
          <button type="button" className="primary icon-btn" title="Add item" aria-label="Add item" onClick={() => setShowAddItemModal(true)}>
            +
          </button>
          <button type="button" className="icon-btn" title="Filters" aria-label="Filters">
            <UiIcon name="filter" />
          </button>
          <button type="button" className="icon-btn" title="Columns" aria-label="Columns">
            <UiIcon name="columns" />
          </button>
        </div>
      </div>

      <div className="data-grid table mobile-stack-table">
        <div className="data-grid-head table-row table-head-row catalog-row">
          <strong>Name</strong>
          <strong>Type</strong>
          <strong>Unit</strong>
          <strong>Rate</strong>
          <strong>Tax</strong>
          <strong>Actions</strong>
        </div>
        {filteredCatalog.map((item) => (
          <div key={item.id} className="catalog-block mobile-stack-card">
            <div className="data-grid-row table-row catalog-row mobile-stack-row">
              <span data-label="Name">{item.name}</span>
              <span data-label="Type">{item.type}</span>
              <span data-label="Unit">{item.unit}</span>
              <span data-label="Rate">${item.defaultPrice.toFixed(2)}</span>
              <span data-label="Tax">{item.taxRate}%</span>
              <div className="row-actions cell-actions" data-label="Actions">
                <button className="icon-btn" title="Edit Item" aria-label="Edit Item" onClick={() => startEdit(item)}>
                  <UiIcon name="edit" />
                </button>
                <button className="icon-btn danger-btn" title="Delete Item" aria-label="Delete Item" onClick={() => deleteItem(item.id)}>
                  <UiIcon name="trash" />
                </button>
              </div>
            </div>

            {editingId === item.id && (
              <div className="inline-editor">
                <div className="form-grid">
                  <label>
                    Name
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </label>
                  <label>
                    Price
                    <input
                      type="number"
                      value={editForm.defaultPrice}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, defaultPrice: Number(e.target.value) || 0 }))
                      }
                    />
                  </label>
                  <label>
                    Type
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, type: e.target.value as CatalogItem['type'] }))}
                    >
                      <option>Service</option>
                      <option>Product</option>
                    </select>
                  </label>
                  <label>
                    Unit
                    <select
                      value={editForm.unit}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, unit: e.target.value as CatalogItem['unit'] }))}
                    >
                      <option>Hour</option>
                      <option>Unit</option>
                    </select>
                  </label>
                  <label>
                    Tax
                    <input
                      type="number"
                      value={editForm.taxRate}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, taxRate: Number(e.target.value) || 0 }))}
                    />
                  </label>
                </div>
                <div className="editor-actions">
                  <button className="primary" onClick={saveEdit}>
                    Save
                  </button>
                  <button onClick={cancelEdit}>Close</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!filteredCatalog.length && <p className="muted">No matching item found.</p>}
        <div className="data-grid-footer table-footer">
          <span className="muted">Rows per page: 10</span>
          <span className="muted">
            1 - {Math.min(filteredCatalog.length, 10)} of {filteredCatalog.length}
          </span>
        </div>
      </div>

      {showAddItemModal && (
        <div className="inline-modal-backdrop">
          <div className="inline-modal">
            <h3>Add Item / Service</h3>
            <p className="muted">Create a new catalog entry from modal.</p>
            <div className="form-grid">
              <label>
                Name
                <input
                  value={newItem.name}
                  onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Item/Service name"
                />
              </label>
              <label>
                Default Price
                <input
                  type="number"
                  value={newItem.defaultPrice}
                  onChange={(e) => setNewItem((prev) => ({ ...prev, defaultPrice: Number(e.target.value) || 0 }))}
                />
              </label>
              <label>
                Type
                <select
                  value={newItem.type}
                  onChange={(e) => setNewItem((prev) => ({ ...prev, type: e.target.value as CatalogItem['type'] }))}
                >
                  <option>Service</option>
                  <option>Product</option>
                </select>
              </label>
              <label>
                Unit
                <select
                  value={newItem.unit}
                  onChange={(e) => setNewItem((prev) => ({ ...prev, unit: e.target.value as CatalogItem['unit'] }))}
                >
                  <option>Hour</option>
                  <option>Unit</option>
                </select>
              </label>
              <label>
                Tax Rate (%)
                <input
                  type="number"
                  value={newItem.taxRate}
                  onChange={(e) => setNewItem((prev) => ({ ...prev, taxRate: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>
            <div className="editor-actions">
              <button className="primary" onClick={saveNewItem}>
                Save
              </button>
              <button onClick={() => setShowAddItemModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function CreateInvoicePage({
  clientName,
  setClientName,
  clientGstHstNumber,
  setClientGstHstNumber,
  selectedClientId: _selectedClientId,
  setSelectedClientId,
  clients,
  onUpdateClients,
  profile,
  invoices,
  meta,
  setMeta,
  catalog,
  addCatalogItem,
  draftLines,
  updateLine,
  removeLine,
  totals,
  exportPdf,
  invoiceNumberEditedRef,
}: {
  clientName: string
  setClientName: (name: string) => void
  clientGstHstNumber: string
  setClientGstHstNumber: (value: string) => void
  selectedClientId: string
  setSelectedClientId: (value: string) => void
  clients: ClientRecord[]
  onUpdateClients: (clients: ClientRecord[]) => Promise<void>
  profile: CompanyProfile
  invoices: InvoiceRecord[]
  meta: InvoiceMeta
  setMeta: Dispatch<SetStateAction<InvoiceMeta>>
  catalog: CatalogItem[]
  addCatalogItem: (id: number) => void
  draftLines: DraftInvoiceLine[]
  updateLine: (index: number, key: 'quantity' | 'customPrice', value: number) => void
  removeLine: (index: number) => void
  totals: {
    subTotalRaw: number
    subTotal: number
    taxTotal: number
    grandTotal: number
    taxByRate: { rate: number; amount: number; label: string }[]
  }
  exportPdf: () => Promise<void>
  invoiceNumberEditedRef: MutableRefObject<boolean>
}) {
  const [clientQuery, setClientQuery] = useState(clientName)
  const [showClientOptions, setShowClientOptions] = useState(false)
  const [showAddClientModal, setShowAddClientModal] = useState(false)
  const [newClient, setNewClient] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    streetAddress: '',
    city: '',
    province: '',
    postalCode: '',
    gstHstNumber: '',
  })
  useEffect(() => {
    if (invoiceNumberEditedRef.current) return
    setMeta((prev) => ({
      ...prev,
      invoiceNumber: getNextInvoiceNumber(profile.invoiceNumberPrefix, profile.invoiceNumberYear, invoices),
    }))
  }, [profile.invoiceNumberPrefix, profile.invoiceNumberYear, invoices])

  const numberAlreadyUsed = invoices.some(
    (inv) => inv.invoiceNumber.trim() === meta.invoiceNumber.trim() && meta.invoiceNumber.trim().length > 0,
  )

  const updateMeta = (key: keyof InvoiceMeta, value: string) => {
    if (key === 'invoiceNumber') {
      invoiceNumberEditedRef.current = true
    }
    if (key === 'discount' || key === 'shipping') {
      setMeta({ ...meta, [key]: Number(value) || 0 })
      return
    }
    setMeta({ ...meta, [key]: value })
  }

  const clientOptions = clients.filter((client) =>
    `${client.name} ${client.company}`.toLowerCase().includes(clientQuery.toLowerCase()),
  )

  const matchedBillToClient = useMemo(() => {
    const label = clientName.trim()
    return (
      clients.find((c) => `${c.company} (${c.name})` === label) ??
      (clientGstHstNumber.trim()
        ? clients.find((c) => c.gstHstNumber.trim() === clientGstHstNumber.trim())
        : undefined)
    )
  }, [clients, clientName, clientGstHstNumber])

  const onClientInput = (value: string) => {
    setClientQuery(value)
    setClientName(value)
    setClientGstHstNumber('')
    setSelectedClientId('')
    setShowClientOptions(true)
  }

  const chooseClient = (client: ClientRecord) => {
    const label = `${client.company} (${client.name})`
    setClientQuery(label)
    setClientName(label)
    setClientGstHstNumber(client.gstHstNumber || '')
    setSelectedClientId(client.id)
    setShowClientOptions(false)
  }

  const openAddClient = () => {
    setNewClient((prev) => ({
      ...prev,
      company: clientQuery.trim(),
    }))
    setShowClientOptions(false)
    setShowAddClientModal(true)
  }

  const saveNewClient = () => {
    if (
      !newClient.name.trim() ||
      !newClient.company.trim() ||
      !newClient.email.trim() ||
      !newClient.streetAddress.trim() ||
      !newClient.city.trim() ||
      !newClient.province.trim() ||
      !newClient.postalCode.trim() ||
      !newClient.gstHstNumber.trim()
    )
      return
    const created: ClientRecord = {
      id: getNextClientId(clients),
      name: newClient.name.trim(),
      company: newClient.company.trim(),
      email: newClient.email.trim(),
      phone: newClient.phone.trim(),
      streetAddress: newClient.streetAddress.trim(),
      city: newClient.city.trim(),
      province: newClient.province.trim().toUpperCase(),
      postalCode: newClient.postalCode.trim().toUpperCase(),
      gstHstNumber: newClient.gstHstNumber.trim(),
      totalInvoiced: 0,
    }
    void (async () => {
      try {
        await onUpdateClients([created, ...clients])
        chooseClient(created)
        setShowAddClientModal(false)
        setNewClient({
          name: '',
          company: '',
          email: '',
          phone: '',
          streetAddress: '',
          city: '',
          province: '',
          postalCode: '',
          gstHstNumber: '',
        })
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Could not save client')
      }
    })()
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Create Invoice</h2>
          <p className="muted">Draft, edit, and export professional invoices with clear tax and payment terms.</p>
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void exportPdf().catch((err) => {
              window.alert(err instanceof Error ? err.message : 'Export failed')
            })
          }}
        >
          Export PDF & save invoice
        </button>
      </div>
      <div className="insight-banner">
        <strong>Smart Tip:</strong> Invoices with clear due date + item details are paid faster.
      </div>

      <div className="invoice-layout">
        <div>
          <div className="invoice-sender-strip">
            <strong>{profile.companyName}</strong>
            {profile.streetAddress.trim() ? (
              <span className="invoice-sender-strip__muted">{profile.streetAddress}</span>
            ) : null}
            {(() => {
              const cityLine = [profile.city, profile.province, profile.postalCode]
                .map((s) => s.trim())
                .filter(Boolean)
                .join(', ')
              return cityLine ? <span className="invoice-sender-strip__muted">{cityLine}</span> : null
            })()}
            <span className="invoice-sender-strip__muted">
              {profile.phone} · {profile.email}
            </span>
            <span className="invoice-sender-strip__reg">GST/HST registration: {profile.gstHstNumber}</span>
          </div>

          <div className="card invoice-details-card">
            <h3>Client & invoice details</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Bill-to and invoice number / dates match the PDF layout.
            </p>
            <label className="invoice-client-full">
              Bill to (client)
              <div className="client-combobox">
                <input
                  value={clientQuery}
                  onChange={(e) => onClientInput(e.target.value)}
                  onFocus={() => setShowClientOptions(true)}
                  onBlur={() => setTimeout(() => setShowClientOptions(false), 150)}
                  placeholder="Search client or type new"
                />
                {showClientOptions && clientOptions.length > 0 && (
                  <div className="client-options">
                    {clientOptions.slice(0, 6).map((client) => (
                      <button key={client.id} type="button" className="client-option" onClick={() => chooseClient(client)}>
                        <strong>{client.company}</strong>
                        <span>
                          {client.name} - {client.gstHstNumber || 'No GST/HST'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {showClientOptions && clientOptions.length === 0 && clientQuery.trim().length > 0 && (
                  <div className="client-options">
                    <button type="button" className="client-option add-option" onClick={openAddClient}>
                      <strong>Add "{clientQuery.trim()}" as new client</strong>
                      <span>No match found in current client list.</span>
                    </button>
                  </div>
                )}
              </div>
              {matchedBillToClient && (
                <div className="muted" style={{ marginTop: '0.55rem', fontSize: '0.84rem', lineHeight: 1.45 }}>
                  {matchedBillToClient.streetAddress.trim() ? (
                    <div>{matchedBillToClient.streetAddress}</div>
                  ) : null}
                  {(() => {
                    const cityLine = [matchedBillToClient.city, matchedBillToClient.province, matchedBillToClient.postalCode]
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .join(', ')
                    return cityLine ? <div>{cityLine}</div> : null
                  })()}
                  {(matchedBillToClient.phone || matchedBillToClient.email) && (
                    <div style={{ marginTop: 4 }}>
                      {[matchedBillToClient.phone, matchedBillToClient.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </label>

            <div className="invoice-meta-grid">
              <label>
                <span className="invoice-meta-label">Invoice #</span>
                <input
                  value={meta.invoiceNumber}
                  onChange={(e) => updateMeta('invoiceNumber', e.target.value)}
                  placeholder={`INV-${new Date().getFullYear()}-001`}
                />
                {numberAlreadyUsed && (
                  <span className="muted" style={{ color: '#b45309', display: 'block', marginTop: 6, fontSize: 12 }}>
                    This number is already in the Invoices list.
                  </span>
                )}
              </label>
              <label>
                <span className="invoice-meta-label">Issue date</span>
                <input type="date" value={meta.issueDate} onChange={(e) => updateMeta('issueDate', e.target.value)} />
              </label>
              <label>
                <span className="invoice-meta-label">Due date</span>
                <input type="date" value={meta.dueDate} onChange={(e) => updateMeta('dueDate', e.target.value)} />
              </label>
            </div>

            <div className="form-grid two-col-simple" style={{ marginTop: '0.85rem' }}>
              <label>
                Status
                <select value={meta.status} onChange={(e) => updateMeta('status', e.target.value)}>
                  <option>Draft</option>
                  <option>Open</option>
                  <option>Paid</option>
                </select>
              </label>
              <label>
                Discount
                <input
                  type="number"
                  value={meta.discount}
                  onChange={(e) => updateMeta('discount', e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label>
                Shipping
                <input
                  type="number"
                  value={meta.shipping}
                  onChange={(e) => updateMeta('shipping', e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label className="invoice-field-span">
                Add line item
                <select onChange={(e) => addCatalogItem(Number(e.target.value))} defaultValue="">
                  <option value="" disabled>
                    Select item/service
                  </option>
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (${item.defaultPrice})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="card">
            <h3>Line items</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Per-line HST/GST uses each catalog item tax rate.
            </p>
            <div className="table-scroll">
              <p className="mobile-table-scroll-hint">Swipe for all columns</p>
              <div className="invoice-line-table">
              <div className="invoice-line-head">
                <span>Description</span>
                <span>Qty</span>
                <span>Rate</span>
                <span>Tax (HST/GST)</span>
                <span>Line</span>
                <span>Tax $</span>
                <span />
              </div>
              {draftLines.length === 0 && (
                <div className="empty-state invoice-line-empty">
                  <p>No line items yet.</p>
                  <span className="muted">Pick an item from Add line item above.</span>
                </div>
              )}
              {draftLines.map((line, index) => {
                const lineSub = line.quantity * line.customPrice
                const lineTax = lineSub * (line.taxRate / 100)
                return (
                  <div key={`${line.id}-${index}`} className="invoice-line-row">
                    <span>{line.name}</span>
                    <input
                      type="number"
                      value={line.quantity}
                      onChange={(e) => updateLine(index, 'quantity', Number(e.target.value))}
                    />
                    <input
                      type="number"
                      value={line.customPrice}
                      onChange={(e) => updateLine(index, 'customPrice', Number(e.target.value))}
                    />
                    <div className="invoice-tax-cell">
                      <strong>{taxShortLabel(line.taxRate)}</strong>
                      <small>{taxLabelForRate(line.taxRate)}</small>
                    </div>
                    <span>${lineSub.toFixed(2)}</span>
                    <span>${lineTax.toFixed(2)}</span>
                    <button type="button" onClick={() => removeLine(index)}>
                      Remove
                    </button>
                  </div>
                )
              })}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Notes & Terms</h3>
            <label>
              Notes
              <textarea
                rows={3}
                value={meta.notes}
                onChange={(e) => updateMeta('notes', e.target.value)}
                placeholder="Optional notes for client-facing invoice footer..."
              />
            </label>
            <label>
              Payment Terms
              <textarea
                rows={3}
                value={meta.paymentTerms}
                onChange={(e) => updateMeta('paymentTerms', e.target.value)}
                placeholder="Payment instructions, due conditions, late fee terms..."
              />
            </label>
          </div>
        </div>

        <aside className="summary-panel">
          <h3>Invoice Summary</h3>
          <p className="muted">Live totals update as you edit line items and charges.</p>
          <div className="summary-row">
            <span>Status</span>
            <strong>{meta.status}</strong>
          </div>
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>${totals.subTotalRaw.toFixed(2)}</strong>
          </div>
          <div className="summary-row">
            <span>Discount</span>
            <strong>
              {meta.discount > 0
                ? `-$${meta.discount.toFixed(2)}`
                : `$${meta.discount.toFixed(2)}`}
            </strong>
          </div>
          {totals.taxByRate.filter((t) => t.amount >= 0.005).length === 0 && (
            <div className="summary-row">
              <span>Tax</span>
              <strong>$0.00</strong>
            </div>
          )}
          {totals.taxByRate
            .filter((t) => t.amount >= 0.005)
            .map((t) => (
              <div key={t.rate} className="summary-row">
                <span>{t.label}</span>
                <strong>${t.amount.toFixed(2)}</strong>
              </div>
            ))}
          <div className="summary-row">
            <span>Shipping</span>
            <strong>${meta.shipping.toFixed(2)}</strong>
          </div>
          <div className="summary-row">
            <span>Net Before Tax & Shipping</span>
            <strong>${totals.subTotal.toFixed(2)}</strong>
          </div>
          <div className="summary-row total">
            <span>Total Due</span>
            <strong>${totals.grandTotal.toFixed(2)}</strong>
          </div>
        </aside>
      </div>

      {showAddClientModal && (
        <div className="inline-modal-backdrop">
          <div className="inline-modal">
            <h3>Add New Client</h3>
            <p className="muted">Create client without leaving invoice screen.</p>
            <div className="form-grid">
              <label>
                Company
                <input
                  value={newClient.company}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, company: e.target.value }))}
                  placeholder="Company name"
                />
              </label>
              <label>
                Contact Name
                <input
                  value={newClient.name}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Full name"
                />
              </label>
              <label>
                Email
                <input
                  value={newClient.email}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="name@company.com"
                />
              </label>
              <label>
                Phone
                <input
                  value={newClient.phone}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1 ..."
                />
              </label>
              <label>
                Street Address
                <textarea
                  rows={2}
                  value={newClient.streetAddress}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, streetAddress: e.target.value }))}
                  placeholder="123 King St W"
                />
              </label>
              <label>
                City
                <input
                  value={newClient.city}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, city: e.target.value }))}
                  placeholder="Toronto"
                />
              </label>
              <label>
                Province
                <select
                  value={newClient.province}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, province: e.target.value }))}
                >
                  <option value="">Select</option>
                  {CANADA_PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Postal Code
                <input
                  value={newClient.postalCode}
                  onChange={(e) =>
                    setNewClient((prev) => ({ ...prev, postalCode: normalizeCanadianPostalCode(e.target.value) }))
                  }
                  placeholder="A1A 1A1"
                  maxLength={7}
                />
              </label>
              <label>
                Client GST/HST Number
                <input
                  value={newClient.gstHstNumber}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, gstHstNumber: e.target.value }))}
                  placeholder="GST/HST number (if applicable)"
                />
              </label>
            </div>
            <div className="editor-actions">
              <button className="primary" onClick={saveNewClient}>
                Save Client
              </button>
              <button onClick={() => setShowAddClientModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function InvoicesPage({
  invoices,
  onUpdateInvoices,
  onDeleteInvoice,
}: {
  invoices: InvoiceRecord[]
  onUpdateInvoices: (invoices: InvoiceRecord[]) => Promise<void>
  onDeleteInvoice: (invoiceId: string, invoiceNumber: string) => Promise<void>
}) {
  const [paymentAmount, setPaymentAmount] = useState<Record<string, number>>({})
  const [paymentChannel, setPaymentChannel] = useState<Record<string, InvoiceRecord['paymentChannel']>>({})
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRecord | null>(null)
  const [deleteConfirmNumber, setDeleteConfirmNumber] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [invoiceEditForm, setInvoiceEditForm] = useState({
    client: '',
    issueDate: '',
    dueDate: '',
    totalAmount: 0,
    paidAmount: 0,
    status: 'Draft' as InvoiceRecord['status'],
    paymentChannel: 'Interac' as NonNullable<InvoiceRecord['paymentChannel']>,
  })

  const applyPayment = (invoice: InvoiceRecord) => {
    const amount = paymentAmount[invoice.id] || 0
    const channel = paymentChannel[invoice.id] || 'Interac'
    if (amount <= 0 || isInvoiceFullyPaid(invoice)) return

    const updated = invoices.map((item) => {
      if (item.id !== invoice.id) return item
      const nextPaid = Math.min(item.totalAmount, item.paidAmount + amount)
      const remaining = item.totalAmount - nextPaid
      const nextStatus: InvoiceRecord['status'] = remaining <= 0.005 ? 'Paid' : nextPaid > 0 ? 'Partial' : 'Open'
      return {
        ...item,
        paidAmount: nextPaid,
        paymentChannel: channel,
        status: nextStatus,
      }
    })

    setPaymentBusyId(invoice.id)
    setPaymentError(null)
    void (async () => {
      try {
        await onUpdateInvoices(updated)
        setPaymentAmount((prev) => ({ ...prev, [invoice.id]: 0 }))
      } catch (err) {
        setPaymentError(err instanceof Error ? err.message : 'Payment save failed')
      } finally {
        setPaymentBusyId(null)
      }
    })()
  }

  const filteredInvoices = invoices.filter((invoice) =>
    `${invoice.invoiceNumber} ${invoice.client} ${invoice.status}`.toLowerCase().includes(invoiceSearch.toLowerCase()),
  )

  const startInvoiceEdit = (invoice: InvoiceRecord) => {
    setEditingInvoiceId(invoice.id)
    setInvoiceEditForm({
      client: invoice.client,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      status: invoice.status,
      paymentChannel: invoice.paymentChannel || 'Interac',
    })
  }

  const cancelInvoiceEdit = () => {
    setEditingInvoiceId(null)
  }

  const saveInvoiceEdit = () => {
    if (!editingInvoiceId || !invoiceEditForm.client.trim()) return
    const updated = invoices.map((invoice) =>
      invoice.id === editingInvoiceId
        ? {
            ...invoice,
            client: invoiceEditForm.client.trim(),
            issueDate: invoiceEditForm.issueDate,
            dueDate: invoiceEditForm.dueDate,
            totalAmount: Math.max(0, invoiceEditForm.totalAmount),
            paidAmount: Math.max(0, Math.min(invoiceEditForm.paidAmount, invoiceEditForm.totalAmount)),
            status: invoiceEditForm.status,
            paymentChannel: invoiceEditForm.paymentChannel,
          }
        : invoice,
    )
    setPaymentError(null)
    void (async () => {
      try {
        await onUpdateInvoices(updated)
        setEditingInvoiceId(null)
      } catch (err) {
        setPaymentError(err instanceof Error ? err.message : 'Invoice update failed')
      }
    })()
  }

  const openDeleteModal = (invoice: InvoiceRecord) => {
    if (editingInvoiceId === invoice.id) {
      cancelInvoiceEdit()
    }
    setDeleteTarget(invoice)
    setDeleteConfirmNumber('')
    setDeleteError(null)
  }

  const closeDeleteModal = () => {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteConfirmNumber('')
    setDeleteError(null)
  }

  const confirmDeleteInvoice = () => {
    if (!deleteTarget) return
    const expected = deleteTarget.invoiceNumber.trim()
    const typed = deleteConfirmNumber.trim()
    if (typed !== expected) {
      setDeleteError(`Type ${expected} exactly to confirm deletion.`)
      return
    }
    setDeleteBusy(true)
    setDeleteError(null)
    void (async () => {
      try {
        await onDeleteInvoice(deleteTarget.id, expected)
        setDeleteTarget(null)
        setDeleteConfirmNumber('')
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setDeleteBusy(false)
      }
    })()
  }

  const deleteConfirmMatches =
    deleteTarget != null && deleteConfirmNumber.trim() === deleteTarget.invoiceNumber.trim()

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Invoices</h2>
          <p className="muted">View all invoices and process incoming payments quickly.</p>
        </div>
      </div>

      <div className="crm-kpis">
        <article className="card">
          <p className="muted">Total Invoices</p>
          <h3>{invoices.length}</h3>
        </article>
        <article className="card">
          <p className="muted">Open Balance</p>
          <h3>
            $
            {invoices
              .reduce((acc, item) => acc + Math.max(0, item.totalAmount - item.paidAmount), 0)
              .toFixed(2)}
          </h3>
        </article>
        <article className="card">
          <p className="muted">Paid Invoices</p>
          <h3>{invoices.filter((item) => item.status === 'Paid').length}</h3>
        </article>
      </div>

      {paymentError && (
        <p className="danger" role="alert" style={{ marginBottom: '0.75rem' }}>
          {paymentError}
        </p>
      )}

      <div className="card section-panel">
          <div className="page-head">
            <h3>Record payments</h3>
          </div>
          <div className="table-toolbar">
            <div className="search-box compact">
              <span className="search-icon">
                <UiIcon name="search" />
              </span>
              <input
                placeholder="Search invoices (number, client, status)"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
              />
            </div>
            <div className="table-toolbar-actions">
              <button type="button" className="icon-btn" title="Filters" aria-label="Filters">
                <UiIcon name="filter" />
              </button>
              <button type="button" className="icon-btn" title="Columns" aria-label="Columns">
                <UiIcon name="columns" />
              </button>
            </div>
          </div>
          <div className="data-grid invoice-table mobile-stack-table">
            <div className="data-grid-head invoice-table-head invoice-grid">
              <span />
              <span>Invoice</span>
              <span>Client</span>
              <span>Status</span>
              <span>Issue Date</span>
              <span>Due Date</span>
              <span>Total</span>
              <span>Actions</span>
            </div>
            {filteredInvoices.map((invoice) => {
              const remaining = invoiceRemainingAmount(invoice)
              const fullyPaid = isInvoiceFullyPaid(invoice)
              return (
                <div key={invoice.id} className="payment-row mobile-stack-card">
                  <div className="data-grid-row invoice-table-row invoice-grid mobile-stack-row">
                    <span className="cell-checkbox">
                      <input type="checkbox" aria-label={`Select ${invoice.invoiceNumber}`} />
                    </span>
                    <span data-label="Invoice">{invoice.invoiceNumber}</span>
                    <span data-label="Client">{invoice.client}</span>
                    <span data-label="Status" className={`status-chip status-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                    <span data-label="Issue">{invoice.issueDate}</span>
                    <span data-label="Due">{invoice.dueDate}</span>
                    <strong data-label="Total">${invoice.totalAmount.toFixed(2)}</strong>
                    <span className="invoice-row-actions cell-actions" data-label="Actions">
                      {invoice.pdfObjectKey && isApiConfigured() ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Open PDF"
                          aria-label="Open PDF"
                          onClick={() => {
                            void (async () => {
                              const url = await getInvoicePdfDownloadUrl(invoice.pdfObjectKey!)
                              if (url) window.open(url, '_blank', 'noopener,noreferrer')
                              else window.alert('Could not open PDF link. Try signing in again.')
                            })()
                          }}
                        >
                          <UiIcon name="view" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn"
                        title={editingInvoiceId === invoice.id ? 'Close Edit' : 'Quick Edit'}
                        aria-label={editingInvoiceId === invoice.id ? 'Close Edit' : 'Quick Edit'}
                        onClick={() => (editingInvoiceId === invoice.id ? cancelInvoiceEdit() : startInvoiceEdit(invoice))}
                      >
                        <UiIcon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger-btn"
                        title="Delete invoice"
                        aria-label="Delete invoice"
                        onClick={() => openDeleteModal(invoice)}
                      >
                        <UiIcon name="trash" />
                      </button>
                    </span>
                  </div>
                  {!fullyPaid && (
                  <div className="payment-controls">
                    <span className="muted payment-meta">
                      Paid: ${invoice.paidAmount.toFixed(2)} | Remaining: ${remaining.toFixed(2)}
                    </span>
                    <select
                      className="payment-channel-field"
                      value={paymentChannel[invoice.id] || invoice.paymentChannel || 'Interac'}
                      onChange={(e) =>
                        setPaymentChannel((prev) => ({
                          ...prev,
                          [invoice.id]: e.target.value as InvoiceRecord['paymentChannel'],
                        }))
                      }
                    >
                      <option>Interac e-Transfer</option>
                      <option>E-Transfer</option>
                      <option>Interac</option>
                      <option>Bank Transfer</option>
                      <option>Credit Card</option>
                      <option>Cash</option>
                    </select>
                    <input
                      type="number"
                      className="payment-amount-field"
                      value={paymentAmount[invoice.id] ?? ''}
                      onChange={(e) =>
                        setPaymentAmount((prev) => ({ ...prev, [invoice.id]: Number(e.target.value) || 0 }))
                      }
                      placeholder="Payment amount"
                      min={0}
                      step="0.01"
                    />
                    <div className="payment-actions">
                      <button
                        type="button"
                        className="primary icon-btn"
                        disabled={paymentBusyId === invoice.id}
                        onClick={() => applyPayment(invoice)}
                        title="Mark Payment"
                        aria-label="Mark Payment"
                      >
                        <UiIcon name="check" />
                      </button>
                      {editingInvoiceId === invoice.id && (
                        <button type="button" className="icon-btn" title="Save Edit" aria-label="Save Edit" onClick={saveInvoiceEdit}>
                          <UiIcon name="save" />
                        </button>
                      )}
                    </div>
                  </div>
                  )}

                  {editingInvoiceId === invoice.id && (
                    <div className="inline-editor">
                      <div className="invoice-edit-grid">
                        <label>
                          Client
                          <input
                            value={invoiceEditForm.client}
                            onChange={(e) => setInvoiceEditForm((prev) => ({ ...prev, client: e.target.value }))}
                            placeholder="Client name"
                          />
                        </label>
                        <label>
                          Status
                          <select
                            value={invoiceEditForm.status}
                            onChange={(e) =>
                              setInvoiceEditForm((prev) => ({ ...prev, status: e.target.value as InvoiceRecord['status'] }))
                            }
                          >
                            <option>Draft</option>
                            <option>Open</option>
                            <option>Partial</option>
                            <option>Paid</option>
                            <option>Overdue</option>
                          </select>
                        </label>
                        <label>
                          Issue Date
                          <input
                            type="date"
                            value={invoiceEditForm.issueDate}
                            onChange={(e) => setInvoiceEditForm((prev) => ({ ...prev, issueDate: e.target.value }))}
                          />
                        </label>
                        <label>
                          Due Date
                          <input
                            type="date"
                            value={invoiceEditForm.dueDate}
                            onChange={(e) => setInvoiceEditForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                          />
                        </label>
                        <label>
                          Total Amount
                          <input
                            type="number"
                            value={invoiceEditForm.totalAmount}
                            onChange={(e) =>
                              setInvoiceEditForm((prev) => ({ ...prev, totalAmount: Number(e.target.value) || 0 }))
                            }
                          />
                        </label>
                        <label>
                          Paid Amount
                          <input
                            type="number"
                            value={invoiceEditForm.paidAmount}
                            onChange={(e) =>
                              setInvoiceEditForm((prev) => ({ ...prev, paidAmount: Number(e.target.value) || 0 }))
                            }
                          />
                        </label>
                        <label className="invoice-field-span">
                          Payment Channel
                          <select
                            value={invoiceEditForm.paymentChannel}
                            onChange={(e) =>
                              setInvoiceEditForm((prev) => ({
                                ...prev,
                                paymentChannel: e.target.value as NonNullable<InvoiceRecord['paymentChannel']>,
                              }))
                            }
                          >
                            <option>Interac e-Transfer</option>
                            <option>E-Transfer</option>
                            <option>Interac</option>
                            <option>Bank Transfer</option>
                            <option>Credit Card</option>
                            <option>Cash</option>
                          </select>
                        </label>
                      </div>
                      <div className="editor-actions">
                        <button className="primary" type="button" onClick={saveInvoiceEdit}>
                          Save
                        </button>
                        <button type="button" onClick={cancelInvoiceEdit}>
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="data-grid-footer table-footer">
            <span className="muted">Rows per page: 10</span>
            <span className="muted">
              1 - {Math.min(filteredInvoices.length, 10)} of {filteredInvoices.length}
            </span>
          </div>
        </div>

      {deleteTarget && (
        <div className="inline-modal-backdrop" onClick={closeDeleteModal}>
          <div
            className="inline-modal delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-invoice-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-invoice-title">Delete invoice</h3>
            <p className="muted">
              This permanently removes <strong>{deleteTarget.invoiceNumber}</strong> from your workspace, including line
              items and the stored PDF (if any). This cannot be undone.
            </p>
            <div className="delete-confirm-box">
              <p>
                To confirm, type <code>{deleteTarget.invoiceNumber}</code> below:
              </p>
              <input
                autoFocus
                value={deleteConfirmNumber}
                onChange={(e) => {
                  setDeleteConfirmNumber(e.target.value)
                  setDeleteError(null)
                }}
                placeholder={deleteTarget.invoiceNumber}
                aria-label="Confirm invoice number"
              />
            </div>
            {deleteError && (
              <p className="danger delete-confirm-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="editor-actions">
              <button type="button" className="danger-btn" disabled={!deleteConfirmMatches || deleteBusy} onClick={confirmDeleteInvoice}>
                {deleteBusy ? 'Deleting…' : 'Delete invoice'}
              </button>
              <button type="button" disabled={deleteBusy} onClick={closeDeleteModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  )
}

function ClientsPage({
  clients,
  onUpdateClients,
  onDeleteClient,
}: {
  clients: ClientRecord[]
  onUpdateClients: (clients: ClientRecord[]) => Promise<void>
  onDeleteClient: (clientId: string, clientIdConfirm: string) => Promise<void>
}) {
  const [clientSearch, setClientSearch] = useState('')
  const [clientSort, setClientSort] = useState<'name-asc' | 'name-desc' | 'invoice-desc'>('name-asc')
  const [showClientModal, setShowClientModal] = useState(false)
  const [clientSaveBusy, setClientSaveBusy] = useState(false)
  const [clientSaveError, setClientSaveError] = useState<string | null>(null)
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [clientForm, setClientForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    streetAddress: '',
    city: '',
    province: '',
    postalCode: '',
    gstHstNumber: '',
  })

  const openAddClientModal = () => {
    setEditingClientId(null)
    setClientForm({
      name: '',
      email: '',
      phone: '',
      company: '',
      streetAddress: '',
      city: '',
      province: '',
      postalCode: '',
      gstHstNumber: '',
    })
    setShowClientModal(true)
  }

  const openEditClientModal = (client: ClientRecord) => {
    setEditingClientId(client.id)
    setClientForm({
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      streetAddress: client.streetAddress,
      city: client.city,
      province: client.province,
      postalCode: client.postalCode,
      gstHstNumber: client.gstHstNumber,
    })
    setShowClientModal(true)
  }

  const saveClient = () => {
    if (
      !clientForm.name.trim() ||
      !clientForm.company.trim() ||
      !clientForm.email.trim() ||
      !clientForm.streetAddress.trim() ||
      !clientForm.city.trim() ||
      !clientForm.province.trim() ||
      !clientForm.postalCode.trim() ||
      clientSaveBusy
    )
      return
    setClientSaveBusy(true)
    setClientSaveError(null)
    void (async () => {
      try {
        if (editingClientId) {
          await onUpdateClients(
            clients.map((client) =>
              client.id === editingClientId
                ? {
                    ...client,
                    name: clientForm.name.trim(),
                    email: clientForm.email.trim(),
                    phone: clientForm.phone.trim(),
                    company: clientForm.company.trim(),
                    streetAddress: clientForm.streetAddress.trim(),
                    city: clientForm.city.trim(),
                    province: clientForm.province.trim().toUpperCase(),
                    postalCode: clientForm.postalCode.trim().toUpperCase(),
                    gstHstNumber: clientForm.gstHstNumber.trim(),
                  }
                : client,
            ),
          )
        } else {
          const next: ClientRecord = {
            id: getNextClientId(clients),
            name: clientForm.name.trim(),
            email: clientForm.email.trim(),
            phone: clientForm.phone.trim(),
            company: clientForm.company.trim(),
            streetAddress: clientForm.streetAddress.trim(),
            city: clientForm.city.trim(),
            province: clientForm.province.trim().toUpperCase(),
            postalCode: clientForm.postalCode.trim().toUpperCase(),
            gstHstNumber: clientForm.gstHstNumber.trim(),
            totalInvoiced: 0,
          }
          await onUpdateClients([next, ...clients])
        }
        setShowClientModal(false)
      } catch (err) {
        setClientSaveError(err instanceof Error ? err.message : 'Could not save client')
      } finally {
        setClientSaveBusy(false)
      }
    })()
  }

  const openDeleteModal = (client: ClientRecord) => {
    if (showClientModal) {
      setShowClientModal(false)
    }
    setDeleteTarget(client)
    setDeleteConfirmId('')
    setDeleteError(null)
  }

  const closeDeleteModal = () => {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteConfirmId('')
    setDeleteError(null)
  }

  const confirmDeleteClient = () => {
    if (!deleteTarget) return
    const expected = formatClientIdDisplay(deleteTarget.id)
    const typed = deleteConfirmId.trim()
    if (typed !== expected) {
      setDeleteError(`Type ${expected} exactly to confirm deletion.`)
      return
    }
    setDeleteBusy(true)
    setDeleteError(null)
    void (async () => {
      try {
        await onDeleteClient(deleteTarget.id, expected)
        setDeleteTarget(null)
        setDeleteConfirmId('')
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setDeleteBusy(false)
      }
    })()
  }

  const deleteConfirmMatches =
    deleteTarget != null && deleteConfirmId.trim() === formatClientIdDisplay(deleteTarget.id)

  const filteredClients = clients
    .filter((client) =>
      `${client.name} ${client.company} ${client.email} ${client.phone} ${client.streetAddress} ${client.city} ${client.province} ${client.postalCode} ${client.gstHstNumber}`
        .toLowerCase()
        .includes(clientSearch.toLowerCase()),
    )
    .sort((a, b) => {
      if (clientSort === 'name-asc') return a.name.localeCompare(b.name)
      if (clientSort === 'name-desc') return b.name.localeCompare(a.name)
      return b.totalInvoiced - a.totalInvoiced
    })

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Clients</h2>
          <p className="muted">Manage your client directory in a dedicated workspace.</p>
        </div>
      </div>

      {clientSaveError && (
        <p className="danger" role="alert" style={{ marginBottom: '0.75rem' }}>
          {clientSaveError}
        </p>
      )}

      <div className="card section-panel">
        <div className="clients-toolbar">
          <div className="search-box compact">
            <span className="search-icon">
              <UiIcon name="search" />
            </span>
            <input
              placeholder="Search clients..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
          </div>
          <div className="table-toolbar-actions">
            <div className="sort-box">
              <span className="sort-label">Sort</span>
              <select value={clientSort} onChange={(e) => setClientSort(e.target.value as typeof clientSort)}>
                <option value="name-asc">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
                <option value="invoice-desc">Highest Invoiced</option>
              </select>
            </div>
            <button type="button" className="primary icon-btn" title="Add client" aria-label="Add client" onClick={openAddClientModal}>
              +
            </button>
            <button type="button" className="icon-btn" title="Filters" aria-label="Filters">
              <UiIcon name="filter" />
            </button>
            <button type="button" className="icon-btn" title="Columns" aria-label="Columns">
              <UiIcon name="columns" />
            </button>
          </div>
        </div>

        <div className="data-grid table mobile-stack-table">
          <div className="data-grid-head table-row table-head-row client-row client-grid">
            <strong />
            <strong>Member</strong>
            <strong>Client ID</strong>
            <strong>GST/HST</strong>
            <strong>Location</strong>
            <strong>Total</strong>
            <strong>Actions</strong>
          </div>
          {filteredClients.map((client) => (
            <div key={client.id} className="data-grid-row table-row client-row client-grid mobile-stack-row mobile-stack-card">
              <span className="cell-checkbox">
                <input type="checkbox" aria-label={`Select ${client.name}`} />
              </span>
              <span data-label="Member">
                <strong>{client.name}</strong>
                <br />
                <span className="muted">{client.email || '-'}</span>
              </span>
              <span data-label="Client ID">{formatClientIdDisplay(client.id)}</span>
              <span data-label="GST/HST">{client.gstHstNumber || '-'}</span>
              <span data-label="Location">
                {client.city}, {client.province}
              </span>
              <strong data-label="Total">${client.totalInvoiced.toFixed(2)}</strong>
              <div className="row-actions cell-actions" data-label="Actions">
                <button className="icon-btn" title="Quick Edit" aria-label="Quick Edit" onClick={() => openEditClientModal(client)}>
                  <UiIcon name="edit" />
                </button>
                <button
                  type="button"
                  className="icon-btn danger-btn"
                  title="Delete client"
                  aria-label="Delete client"
                  onClick={() => openDeleteModal(client)}
                >
                  <UiIcon name="trash" />
                </button>
              </div>
            </div>
          ))}
          {!filteredClients.length && <p className="muted">No client matched your search.</p>}
        </div>
        <div className="data-grid-footer table-footer">
          <span className="muted">Rows per page: 10</span>
          <span className="muted">
            1 - {Math.min(filteredClients.length, 10)} of {filteredClients.length}
          </span>
        </div>
      </div>

      {showClientModal && (
        <div className="inline-modal-backdrop">
          <div className="inline-modal">
            <h3>{editingClientId ? 'Quick Edit Client' : 'Add New Client'}</h3>
            <p className="muted">Update client details without leaving this page.</p>
            <div className="form-grid">
              <label>
                Name
                <input
                  value={clientForm.name}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Client full name"
                />
              </label>
              <label>
                Company
                <input
                  value={clientForm.company}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, company: e.target.value }))}
                  placeholder="Company name"
                />
              </label>
              <label>
                Email
                <input
                  value={clientForm.email}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="name@company.com"
                />
              </label>
              <label>
                Phone
                <input
                  value={clientForm.phone}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1 ..."
                />
              </label>
              <label>
                Street Address
                <textarea
                  rows={2}
                  value={clientForm.streetAddress}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, streetAddress: e.target.value }))}
                  placeholder="123 King St W"
                />
              </label>
              <label>
                City
                <input
                  value={clientForm.city}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, city: e.target.value }))}
                  placeholder="Toronto"
                />
              </label>
              <label>
                Province
                <select
                  value={clientForm.province}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, province: e.target.value }))}
                >
                  <option value="">Select</option>
                  {CANADA_PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Postal Code
                <input
                  value={clientForm.postalCode}
                  onChange={(e) =>
                    setClientForm((prev) => ({ ...prev, postalCode: normalizeCanadianPostalCode(e.target.value) }))
                  }
                  placeholder="A1A 1A1"
                  maxLength={7}
                />
              </label>
              <label>
                GST/HST Number
                <input
                  value={clientForm.gstHstNumber}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, gstHstNumber: e.target.value }))}
                  placeholder="GST/HST number (if applicable)"
                />
              </label>
            </div>
            <div className="editor-actions">
              <button className="primary" onClick={saveClient}>
                {editingClientId ? 'Save Changes' : 'Save Client'}
              </button>
              <button onClick={() => setShowClientModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="inline-modal-backdrop" onClick={closeDeleteModal}>
          <div
            className="inline-modal delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-client-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-client-title">Delete client</h3>
            <p className="muted">
              This permanently removes <strong>{deleteTarget.name}</strong> (
              {formatClientIdDisplay(deleteTarget.id)}) from your client directory. Existing invoices are not deleted.
              This cannot be undone.
            </p>
            <div className="delete-confirm-box">
              <p>
                To confirm, type <code>{formatClientIdDisplay(deleteTarget.id)}</code> below:
              </p>
              <input
                autoFocus
                value={deleteConfirmId}
                onChange={(e) => {
                  setDeleteConfirmId(e.target.value)
                  setDeleteError(null)
                }}
                placeholder={formatClientIdDisplay(deleteTarget.id)}
                aria-label="Confirm client ID"
              />
            </div>
            {deleteError && (
              <p className="danger delete-confirm-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="editor-actions">
              <button type="button" className="danger-btn" disabled={!deleteConfirmMatches || deleteBusy} onClick={confirmDeleteClient}>
                {deleteBusy ? 'Deleting…' : 'Delete client'}
              </button>
              <button type="button" disabled={deleteBusy} onClick={closeDeleteModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default App
