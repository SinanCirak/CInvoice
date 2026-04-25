import { type ChangeEvent, type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'

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
  client: string
  issueDate: string
  dueDate: string
  totalAmount: number
  paidAmount: number
  status: 'Draft' | 'Open' | 'Partial' | 'Paid' | 'Overdue'
  paymentChannel?: 'Interac' | 'Bank Transfer' | 'Credit Card' | 'Cash'
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

const initialProfile: CompanyProfile = {
  companyName: `${APP_BRAND} Studio`,
  ownerName: 'Alex Carter',
  email: 'billing@cinvoice.com',
  phone: '+1 416 000 0000',
  streetAddress: '101 King St W',
  city: 'Toronto',
  province: 'ON',
  postalCode: '',
  logoDataUrl: '',
  gstHstNumber: 'GST/HST-CA-4452',
  invoiceNumberPrefix: 'INV',
  invoiceNumberYear: new Date().getFullYear().toString(),
}

const initialCatalog: CatalogItem[] = [
  { id: 1, type: 'Service', name: 'Web Development', unit: 'Hour', defaultPrice: 95, taxRate: 13 },
  { id: 2, type: 'Service', name: 'UI/UX Design', unit: 'Hour', defaultPrice: 80, taxRate: 13 },
  { id: 3, type: 'Product', name: 'Hosting Package', unit: 'Unit', defaultPrice: 45, taxRate: 13 },
]

const brandLogoPath = '/logo.png'

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

const initialInvoices: InvoiceRecord[] = [
  {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-041',
    client: 'Northwind Labs',
    issueDate: '2026-04-10',
    dueDate: '2026-04-20',
    totalAmount: 1840,
    paidAmount: 1840,
    status: 'Paid',
    paymentChannel: 'Interac',
  },
  {
    id: 'inv-2',
    invoiceNumber: 'INV-2026-042',
    client: 'Apex Mechanical',
    issueDate: '2026-04-12',
    dueDate: '2026-04-28',
    totalAmount: 2250,
    paidAmount: 1000,
    status: 'Partial',
    paymentChannel: 'Bank Transfer',
  },
  {
    id: 'inv-3',
    invoiceNumber: 'INV-2026-043',
    client: 'Summit Dental',
    issueDate: '2026-04-15',
    dueDate: '2026-05-02',
    totalAmount: 920,
    paidAmount: 0,
    status: 'Open',
  },
]

const createInitialInvoiceMeta = (): InvoiceMeta => ({
  invoiceNumber: getNextInvoiceNumber(
    initialProfile.invoiceNumberPrefix,
    initialProfile.invoiceNumberYear,
    initialInvoices,
  ),
  issueDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  status: 'Draft',
  paymentTerms: 'Payment due within 14 days by bank transfer or card.',
  notes: 'Thanks for your business. Late fee: 1.5% monthly after due date.',
  discount: 0,
  shipping: 0,
})

const initialClients: ClientRecord[] = [
  {
    id: 'cl-1',
    name: 'Daniel Brooks',
    email: 'daniel@northwindlabs.ca',
    phone: '+1 416 222 1111',
    company: 'Northwind Labs',
    streetAddress: '220 Bay St',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5J 2W4',
    gstHstNumber: 'GST/HST-CL-1001',
    totalInvoiced: 1840,
  },
  {
    id: 'cl-2',
    name: 'Amanda Fox',
    email: 'amanda@apexmech.ca',
    phone: '+1 647 555 8922',
    company: 'Apex Mechanical',
    streetAddress: '14 Industrial Rd',
    city: 'Mississauga',
    province: 'ON',
    postalCode: 'L5B 1M2',
    gstHstNumber: 'GST/HST-CL-1002',
    totalInvoiced: 2250,
  },
  {
    id: 'cl-3',
    name: 'Chris Lewis',
    email: 'chris@summitdental.ca',
    phone: '+1 905 123 7788',
    company: 'Summit Dental',
    streetAddress: '88 Main St N',
    city: 'Brampton',
    province: 'ON',
    postalCode: 'L6V 1N6',
    gstHstNumber: 'GST/HST-CL-1003',
    totalInvoiced: 920,
  },
]

function App() {
  const [profile, setProfile] = useState(initialProfile)
  const [catalog, setCatalog] = useState(initialCatalog)
  const [draftLines, setDraftLines] = useState<DraftInvoiceLine[]>([])
  const [clientName, setClientName] = useState('Sample Client Inc.')
  const [clientGstHstNumber, setClientGstHstNumber] = useState('')
  const [meta, setMeta] = useState(() => createInitialInvoiceMeta())
  const [invoices, setInvoices] = useState(initialInvoices)
  const [clients, setClients] = useState(initialClients)

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
    const innerMax = logoBox - logoPad * 2
    let imgDrawW = innerMax * 0.92
    let imgDrawH = innerMax * 0.92
    try {
      const props = doc.getImageProperties(logoSource)
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
      doc.addImage(logoSource, 'PNG', logoIx, logoIy, imgDrawW, imgDrawH)
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
    const termsLines = doc.splitTextToSize(meta.paymentTerms, leftColW)
    const notesLines = doc.splitTextToSize(meta.notes, leftColW)
    const innerPad = 5.5
    const leftBlockH =
      innerPad + 5 + termsLines.length * 4.2 + 5 + notesLines.length * 4.2 + 3
    const footerSectionH = Math.max(boxH, leftBlockH) + 6

    if (y + 6 + footerSectionH > PAGE_SAFE) {
      doc.addPage()
      y = 14
    }
    const sectionTop = y + 6
    const leftTitleY = sectionTop + innerPad

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    doc.setFont('helvetica', 'bold')
    doc.text('Payment terms', mL, leftTitleY)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(71, 85, 105)
    doc.text(termsLines, mL, leftTitleY + 5)
    const notesHeaderY = leftTitleY + 5 + termsLines.length * 4.2
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Notes', mL, notesHeaderY)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(71, 85, 105)
    doc.text(notesLines, mL, notesHeaderY + 5)

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
    const tagLineBefore = 'Generated with '
    const tagLineAfter = ' — frontend mock preview'
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      doc.text(`Page ${p} of ${totalPages}`, PW - mR, footerY, { align: 'right' })
      let fx = mL
      doc.text(tagLineBefore, fx, footerY)
      fx += doc.getTextWidth(tagLineBefore)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(100, 116, 130)
      doc.text(APP_BRAND, fx, footerY)
      fx += doc.getTextWidth(APP_BRAND)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(148, 163, 184)
      doc.text(tagLineAfter, fx, footerY)
    }

    doc.save(`${meta.invoiceNumber}.pdf`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-badge brand-logo-box">
            <img src={brandLogoPath} alt={`${APP_BRAND} logo`} className="brand-logo" />
          </span>
          <div>
            <h1>{APP_BRAND}</h1>
            <p className="muted">Billing Workspace</p>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/catalog">Items & Services</NavLink>
          <NavLink to="/create-invoice">Create Invoice</NavLink>
          <NavLink to="/invoices">Invoices</NavLink>
          <NavLink to="/clients">Clients</NavLink>
          <NavLink to="/company">Company Profile</NavLink>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="muted">Environment</p>
            <h2>Production-like Frontend (Mock Data)</h2>
          </div>
          <button className="primary ghost">Upgrade to Cloud Sync</button>
        </header>
        <div className="page-wrap">
          <Routes>
            <Route
              path="/"
              element={<Dashboard totalSales={52740} monthly={[1200, 2800, 3300, 4100, 5300, 6200, 7000]} />}
            />
            <Route path="/company" element={<CompanyPage profile={profile} onChange={setProfile} />} />
            <Route path="/catalog" element={<CatalogPage catalog={catalog} setCatalog={setCatalog} />} />
            <Route
              path="/create-invoice"
              element={
                <CreateInvoicePage
                  clientName={clientName}
                  setClientName={setClientName}
                  clientGstHstNumber={clientGstHstNumber}
                  setClientGstHstNumber={setClientGstHstNumber}
                  clients={clients}
                  setClients={setClients}
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
                />
              }
            />
            <Route
              path="/invoices"
              element={
                <InvoicesPage invoices={invoices} setInvoices={setInvoices} />
              }
            />
            <Route path="/clients" element={<ClientsPage clients={clients} setClients={setClients} />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function Dashboard({ totalSales, monthly }: { totalSales: number; monthly: number[] }) {
  const weeks = '$3,420'
  const today = '$640'
  const year = '$84,910'
  const collectionRate = '92.4%'
  const overdueAmount = '$2,180'
  const taxReserve = '$9,460'
  const uxScore = 86
  const recentInvoices = [
    { no: 'INV-2026-041', client: 'Northwind Labs', status: 'Paid', due: '2026-04-20', amount: '$1,840' },
    { no: 'INV-2026-042', client: 'Apex Mechanical', status: 'Open', due: '2026-04-28', amount: '$2,250' },
    { no: 'INV-2026-043', client: 'Summit Dental', status: 'Draft', due: '2026-05-02', amount: '$920' },
    { no: 'INV-2026-044', client: 'Urban Build Co', status: 'Overdue', due: '2026-04-18', amount: '$1,260' },
  ]

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Sales Dashboard</h2>
          <p className="muted">Track collection health, invoice velocity, and tax exposure in one place.</p>
        </div>
        <button>New Invoice</button>
      </div>
      <div className="quick-actions">
        <button className="action-chip">Send Reminder</button>
        <button className="action-chip">Duplicate Last Invoice</button>
        <button className="action-chip">Export Monthly Report</button>
        <button className="action-chip">Create Tax Snapshot</button>
      </div>
      <div className="stats-grid">
        <article className="card">
          <p className="muted">Today Collected</p>
          <h3>{today}</h3>
          <p className="tiny">+8.2% vs yesterday</p>
        </article>
        <article className="card">
          <p className="muted">This Week</p>
          <h3>{weeks}</h3>
          <p className="tiny">14 invoices issued</p>
        </article>
        <article className="card">
          <p className="muted">Monthly Revenue</p>
          <h3>${totalSales.toLocaleString()}</h3>
          <p className="tiny">Target: $60,000</p>
        </article>
        <article className="card">
          <p className="muted">Year-to-Date</p>
          <h3>{year}</h3>
          <p className="tiny">Forecast: $110,000</p>
        </article>
      </div>

      <div className="split-grid">
        <div className="card">
          <h3>Monthly Trend</h3>
          <div className="bars">
            {monthly.map((value, i) => (
              <div key={value + i} className="bar-wrap">
                <div className="bar" style={{ height: `${Math.round(value / 80)}px` }} />
                <span>M{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Collections & Tax Health</h3>
          <div className="kpi-list">
            <div className="kpi-row">
              <span>Collection Rate</span>
              <strong>{collectionRate}</strong>
            </div>
            <div className="kpi-row">
              <span>Overdue Exposure</span>
              <strong className="danger">{overdueAmount}</strong>
            </div>
            <div className="kpi-row">
              <span>Tax Reserve</span>
              <strong>{taxReserve}</strong>
            </div>
          </div>
          <p className="muted">Next step: connect expenses and auto-generate tax return summary pages.</p>
        </div>
      </div>

      <div className="split-grid">
        <div className="card">
          <h3>Operations Focus</h3>
          <div className="milestone-list">
            <div className="milestone-row">
              <span className="dot done" />
              <div>
                <strong>Invoices sent today</strong>
                <p className="muted">8 sent, 5 viewed by clients.</p>
              </div>
            </div>
            <div className="milestone-row">
              <span className="dot progress" />
              <div>
                <strong>Pending follow-ups</strong>
                <p className="muted">3 open invoices need reminder email.</p>
              </div>
            </div>
            <div className="milestone-row">
              <span className="dot" />
              <div>
                <strong>Tax package prep</strong>
                <p className="muted">Expense module planned for next milestone.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Workspace Quality Score</h3>
          <div className="score-ring">
            <div className="score-ring-inner">
              <strong>{uxScore}%</strong>
              <span>Health</span>
            </div>
          </div>
          <p className="muted">
            Score is based on profile completion, catalog readiness, and invoice structure quality.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="page-head">
          <h3>Recent Invoices</h3>
          <button>View All</button>
        </div>
        <div className="invoice-table">
          <div className="invoice-table-head">
            <span>Invoice</span>
            <span>Client</span>
            <span>Status</span>
            <span>Due Date</span>
            <span>Amount</span>
          </div>
          {recentInvoices.map((invoice) => (
            <div key={invoice.no} className="invoice-table-row">
              <span>{invoice.no}</span>
              <span>{invoice.client}</span>
              <span className={`status-chip status-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
              <span>{invoice.due}</span>
              <strong>{invoice.amount}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CompanyPage({
  profile,
  onChange,
}: {
  profile: CompanyProfile
  onChange: (profile: CompanyProfile) => void
}) {
  const setValue = (key: keyof CompanyProfile, value: string) => {
    onChange({ ...profile, [key]: value })
  }

  const onLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      onChange({ ...profile, logoDataUrl: String(reader.result) })
    }
    reader.readAsDataURL(file)
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Company Profile</h2>
          <p className="muted">Simple setup screen for invoice identity and legal details.</p>
        </div>
        <button>Save Draft</button>
      </div>

      <div className="card">
        <h3>Company Information</h3>
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
          <label className="invoice-field-span">
            Street address
            <input
              value={profile.streetAddress}
              onChange={(e) => setValue('streetAddress', e.target.value)}
              placeholder="e.g. 101 King St W"
            />
          </label>
          <label>
            City
            <input value={profile.city} onChange={(e) => setValue('city', e.target.value)} placeholder="Toronto" />
          </label>
          <label>
            Province / state
            <input value={profile.province} onChange={(e) => setValue('province', e.target.value)} placeholder="ON" />
          </label>
          <label>
            Postal code
            <input
              value={profile.postalCode}
              onChange={(e) => setValue('postalCode', e.target.value)}
              placeholder="M5J 2N8"
            />
          </label>
          <label>
            GST/HST Number
            <input value={profile.gstHstNumber} onChange={(e) => setValue('gstHstNumber', e.target.value)} />
          </label>
          <label>
            Invoice number prefix
            <input
              value={profile.invoiceNumberPrefix}
              onChange={(e) => setValue('invoiceNumberPrefix', e.target.value)}
              placeholder="INV"
            />
            <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              Used for automatic numbering, e.g. {profile.invoiceNumberPrefix || 'INV'}-{profile.invoiceNumberYear || '2026'}-001
            </span>
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
        </div>
      </div>

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

      <div className="logo-upload card">
        <h3>Company Logo</h3>
        <p className="muted">Upload PNG/JPG logo for invoice preview and PDF export.</p>
        <div className="row">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoUpload} />
        </div>
        {profile.logoDataUrl && <img className="logo-preview" src={profile.logoDataUrl} alt="Company logo preview" />}
      </div>
    </section>
  )
}

function CatalogPage({
  catalog,
  setCatalog,
}: {
  catalog: CatalogItem[]
  setCatalog: (items: CatalogItem[]) => void
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState(0)
  const [type, setType] = useState<CatalogItem['type']>('Service')
  const [unit, setUnit] = useState<CatalogItem['unit']>('Hour')
  const [taxRate, setTaxRate] = useState(13)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    type: 'Service' as CatalogItem['type'],
    unit: 'Hour' as CatalogItem['unit'],
    defaultPrice: 0,
    taxRate: 13,
  })

  const addItem = () => {
    if (!name.trim()) return
    const next: CatalogItem = {
      id: Date.now(),
      type,
      name,
      unit,
      defaultPrice: price,
      taxRate,
    }
    setCatalog([...catalog, next])
    setName('')
    setPrice(0)
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
    if (!editingId || !editForm.name.trim()) return
    setCatalog(
      catalog.map((item) =>
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
      ),
    )
    setEditingId(null)
  }

  const deleteItem = (itemId: number) => {
    setCatalog(catalog.filter((item) => item.id !== itemId))
    if (editingId === itemId) {
      setEditingId(null)
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Items & Services Library</h2>
          <p className="muted">Reusable price catalog for faster invoice drafting and fewer input errors.</p>
        </div>
      </div>
      <div className="catalog-entry">
        <input
          className="field-name"
          placeholder="Item/Service name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field-price"
          type="number"
          placeholder="Default price"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
        <select className="field-type" value={type} onChange={(e) => setType(e.target.value as CatalogItem['type'])}>
          <option>Service</option>
          <option>Product</option>
        </select>
        <select className="field-unit" value={unit} onChange={(e) => setUnit(e.target.value as CatalogItem['unit'])}>
          <option>Hour</option>
          <option>Unit</option>
        </select>
        <input
          className="field-tax"
          type="number"
          placeholder="Tax %"
          value={taxRate}
          onChange={(e) => setTaxRate(Number(e.target.value))}
        />
        <button className="field-add" onClick={addItem}>
          Add
        </button>
      </div>
      <div className="row">
        <input placeholder="Search in catalog" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="table">
        <div className="table-row table-head-row">
          <strong>Name</strong>
          <strong>Type</strong>
          <strong>Unit</strong>
          <strong>Rate</strong>
          <strong>Tax</strong>
          <strong>Actions</strong>
        </div>
        {filteredCatalog.map((item) => (
          <div key={item.id} className="catalog-block">
            <div className="table-row catalog-row">
              <span>{item.name}</span>
              <span>{item.type}</span>
              <span>{item.unit}</span>
              <span>${item.defaultPrice.toFixed(2)}</span>
              <span>{item.taxRate}%</span>
              <div className="row-actions">
                <button onClick={() => startEdit(item)}>Quick Edit</button>
                <button className="danger-btn" onClick={() => deleteItem(item.id)}>
                  Delete
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
      </div>
    </section>
  )
}

function CreateInvoicePage({
  clientName,
  setClientName,
  clientGstHstNumber,
  setClientGstHstNumber,
  clients,
  setClients,
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
}: {
  clientName: string
  setClientName: (name: string) => void
  clientGstHstNumber: string
  setClientGstHstNumber: (value: string) => void
  clients: ClientRecord[]
  setClients: (clients: ClientRecord[]) => void
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
  const invoiceNumberEditedRef = useRef(false)

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
    setShowClientOptions(true)
  }

  const chooseClient = (client: ClientRecord) => {
    const label = `${client.company} (${client.name})`
    setClientQuery(label)
    setClientName(label)
    setClientGstHstNumber(client.gstHstNumber || '')
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
      id: `cl-${Date.now()}`,
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
    setClients([created, ...clients])
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
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Create Invoice</h2>
          <p className="muted">Draft, edit, and export professional invoices with clear tax and payment terms.</p>
        </div>
        <button className="primary" onClick={exportPdf}>
          Export PDF
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
                  placeholder="INV-2026-001"
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
            <h3>Terms & Notes</h3>
            <label>
              Payment Terms
              <textarea
                rows={3}
                value={meta.paymentTerms}
                onChange={(e) => updateMeta('paymentTerms', e.target.value)}
                placeholder="Payment instructions, due conditions, late fee terms..."
              />
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={meta.notes}
                onChange={(e) => updateMeta('notes', e.target.value)}
                placeholder="Optional notes for client-facing invoice footer..."
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
          <p className="muted">Backend stage: persist invoice record in DynamoDB and PDF file in S3.</p>
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
                <input
                  value={newClient.province}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, province: e.target.value }))}
                  placeholder="ON"
                />
              </label>
              <label>
                Postal Code
                <input
                  value={newClient.postalCode}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, postalCode: e.target.value }))}
                  placeholder="M5J 2W4"
                />
              </label>
              <label>
                Client GST/HST Number
                <input
                  value={newClient.gstHstNumber}
                  onChange={(e) => setNewClient((prev) => ({ ...prev, gstHstNumber: e.target.value }))}
                  placeholder="GST/HST-CLIENT-0001"
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
  setInvoices,
}: {
  invoices: InvoiceRecord[]
  setInvoices: (invoices: InvoiceRecord[]) => void
}) {
  const [paymentAmount, setPaymentAmount] = useState<Record<string, number>>({})
  const [paymentChannel, setPaymentChannel] = useState<Record<string, InvoiceRecord['paymentChannel']>>({})
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [showPaymentPanel, setShowPaymentPanel] = useState(true)

  const applyPayment = (invoice: InvoiceRecord) => {
    const amount = paymentAmount[invoice.id] || 0
    const channel = paymentChannel[invoice.id] || 'Interac'
    if (amount <= 0) return

    const updated = invoices.map((item) => {
      if (item.id !== invoice.id) return item
      const nextPaid = Math.min(item.totalAmount, item.paidAmount + amount)
      const remaining = item.totalAmount - nextPaid
      const nextStatus: InvoiceRecord['status'] = remaining <= 0 ? 'Paid' : nextPaid > 0 ? 'Partial' : 'Open'
      return {
        ...item,
        paidAmount: nextPaid,
        paymentChannel: channel,
        status: nextStatus,
      }
    })

    setInvoices(updated)
    setPaymentAmount((prev) => ({ ...prev, [invoice.id]: 0 }))
  }

  const filteredInvoices = invoices.filter((invoice) =>
    `${invoice.invoiceNumber} ${invoice.client} ${invoice.status}`.toLowerCase().includes(invoiceSearch.toLowerCase()),
  )

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Invoices</h2>
          <p className="muted">View all invoices and process incoming payments quickly.</p>
        </div>
        <div className="row">
          <button onClick={() => setShowPaymentPanel((prev) => !prev)}>
            {showPaymentPanel ? 'Hide Payments Panel' : 'Show Payments Panel'}
          </button>
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

      {showPaymentPanel && (
        <div className="card section-panel">
          <div className="page-head">
            <h3>Invoice Payments Workspace</h3>
          </div>
          <div className="row">
            <input
              placeholder="Search invoices (number, client, status)"
              value={invoiceSearch}
              onChange={(e) => setInvoiceSearch(e.target.value)}
            />
          </div>
          <div className="invoice-table">
            <div className="invoice-table-head">
              <span>Invoice</span>
              <span>Client</span>
              <span>Status</span>
              <span>Due Date</span>
              <span>Total</span>
            </div>
            {filteredInvoices.map((invoice) => {
              const remaining = Math.max(0, invoice.totalAmount - invoice.paidAmount)
              return (
                <div key={invoice.id} className="payment-row">
                  <div className="invoice-table-row">
                    <span>{invoice.invoiceNumber}</span>
                    <span>{invoice.client}</span>
                    <span className={`status-chip status-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                    <span>{invoice.dueDate}</span>
                    <strong>${invoice.totalAmount.toFixed(2)}</strong>
                  </div>
                  <div className="payment-controls">
                    <span className="muted">
                      Paid: ${invoice.paidAmount.toFixed(2)} | Remaining: ${remaining.toFixed(2)}
                    </span>
                    <select
                      value={paymentChannel[invoice.id] || 'Interac'}
                      onChange={(e) =>
                        setPaymentChannel((prev) => ({
                          ...prev,
                          [invoice.id]: e.target.value as InvoiceRecord['paymentChannel'],
                        }))
                      }
                    >
                      <option>Interac</option>
                      <option>Bank Transfer</option>
                      <option>Credit Card</option>
                      <option>Cash</option>
                    </select>
                    <input
                      type="number"
                      value={paymentAmount[invoice.id] || 0}
                      onChange={(e) =>
                        setPaymentAmount((prev) => ({ ...prev, [invoice.id]: Number(e.target.value) || 0 }))
                      }
                      placeholder="Payment amount"
                    />
                    <button className="primary" onClick={() => applyPayment(invoice)}>
                      Mark Payment
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </section>
  )
}

function ClientsPage({
  clients,
  setClients,
}: {
  clients: ClientRecord[]
  setClients: (clients: ClientRecord[]) => void
}) {
  const [clientSearch, setClientSearch] = useState('')
  const [clientSort, setClientSort] = useState<'name-asc' | 'name-desc' | 'invoice-desc'>('name-asc')
  const [showClientModal, setShowClientModal] = useState(false)
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
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
      !clientForm.postalCode.trim()
    )
      return
    if (editingClientId) {
      setClients(
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
        id: `cl-${Date.now()}`,
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
      setClients([next, ...clients])
    }
    setShowClientModal(false)
  }

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
        <button className="primary" onClick={openAddClientModal}>
          Add Client
        </button>
      </div>

      <div className="card section-panel">
        <div className="clients-toolbar">
          <div className="search-box">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search clients..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
          </div>
          <div className="sort-box">
            <span className="sort-label">Sort</span>
            <select value={clientSort} onChange={(e) => setClientSort(e.target.value as typeof clientSort)}>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="invoice-desc">Highest Invoiced</option>
            </select>
          </div>
        </div>

        <div className="table table-scroll">
          <div className="table-row table-head-row client-row">
            <strong>Name</strong>
              <strong>Contact</strong>
            <strong>GST/HST</strong>
              <strong>Address</strong>
            <strong>Total</strong>
            <strong>Actions</strong>
          </div>
          {filteredClients.map((client) => (
            <div key={client.id} className="table-row client-row">
                <span>{client.name} - {client.company}</span>
                <span>{client.email || '-'}{client.phone ? ` | ${client.phone}` : ''}</span>
              <span>{client.gstHstNumber || '-'}</span>
                <span>{client.streetAddress}, {client.city}, {client.province} {client.postalCode}</span>
              <strong>${client.totalInvoiced.toFixed(2)}</strong>
              <div className="row-actions">
                <button onClick={() => openEditClientModal(client)}>Quick Edit</button>
              </div>
            </div>
          ))}
          {!filteredClients.length && <p className="muted">No client matched your search.</p>}
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
                <input
                  value={clientForm.province}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, province: e.target.value }))}
                  placeholder="ON"
                />
              </label>
              <label>
                Postal Code
                <input
                  value={clientForm.postalCode}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, postalCode: e.target.value }))}
                  placeholder="M5J 2W4"
                />
              </label>
              <label>
                GST/HST Number
                <input
                  value={clientForm.gstHstNumber}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, gstHstNumber: e.target.value }))}
                  placeholder="GST/HST-CLIENT-0001"
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
    </section>
  )
}

export default App
