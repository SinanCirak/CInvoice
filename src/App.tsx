import { useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { jsPDF } from 'jspdf'

type CompanyProfile = {
  companyName: string
  ownerName: string
  email: string
  phone: string
  address: string
  logoUrl: string
  taxNumber: string
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

const initialProfile: CompanyProfile = {
  companyName: 'Cinvoice Studio',
  ownerName: 'Alex Carter',
  email: 'billing@cinvoice.com',
  phone: '+1 416 000 0000',
  address: '101 King St W, Toronto, ON',
  logoUrl: 'https://dummyimage.com/120x40/111827/ffffff&text=Cinvoice',
  taxNumber: 'TAX-CA-4452',
}

const initialCatalog: CatalogItem[] = [
  { id: 1, type: 'Service', name: 'Web Development', unit: 'Hour', defaultPrice: 95, taxRate: 13 },
  { id: 2, type: 'Service', name: 'UI/UX Design', unit: 'Hour', defaultPrice: 80, taxRate: 13 },
  { id: 3, type: 'Product', name: 'Hosting Package', unit: 'Unit', defaultPrice: 45, taxRate: 13 },
]

function App() {
  const [profile, setProfile] = useState(initialProfile)
  const [catalog, setCatalog] = useState(initialCatalog)
  const [draftLines, setDraftLines] = useState<DraftInvoiceLine[]>([])
  const [clientName, setClientName] = useState('Sample Client Inc.')

  const totals = useMemo(() => {
    const subTotal = draftLines.reduce((acc, line) => acc + line.quantity * line.customPrice, 0)
    const taxTotal = draftLines.reduce(
      (acc, line) => acc + line.quantity * line.customPrice * (line.taxRate / 100),
      0,
    )
    return { subTotal, taxTotal, grandTotal: subTotal + taxTotal }
  }, [draftLines])

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

  const exportPdf = () => {
    const doc = new jsPDF()
    doc.setFontSize(18)
    doc.text('Invoice Preview (Frontend Mock)', 14, 18)
    doc.setFontSize(11)
    doc.text(`Company: ${profile.companyName}`, 14, 30)
    doc.text(`Client: ${clientName}`, 14, 37)
    doc.text(`Tax Number: ${profile.taxNumber}`, 14, 44)
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 51)

    let y = 64
    draftLines.forEach((line) => {
      const amount = line.quantity * line.customPrice
      doc.text(
        `${line.name} | Qty/Hours: ${line.quantity} | Price: $${line.customPrice.toFixed(2)} | Amount: $${amount.toFixed(2)}`,
        14,
        y,
      )
      y += 8
    })

    y += 6
    doc.text(`Subtotal: $${totals.subTotal.toFixed(2)}`, 14, y)
    doc.text(`Tax: $${totals.taxTotal.toFixed(2)}`, 14, y + 8)
    doc.text(`Total: $${totals.grandTotal.toFixed(2)}`, 14, y + 16)
    doc.save(`invoice-${Date.now()}.pdf`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Cinvoice</h1>
        <p className="muted">Smart invoicing frontend prototype</p>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/company">Company Profile</NavLink>
          <NavLink to="/catalog">Items & Services</NavLink>
          <NavLink to="/create-invoice">Create Invoice</NavLink>
        </nav>
      </aside>

      <main className="content">
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
        </Routes>
      </main>
    </div>
  )
}

function Dashboard({ totalSales, monthly }: { totalSales: number; monthly: number[] }) {
  const weeks = '$3,420'
  const today = '$640'
  const year = '$84,910'

  return (
    <section>
      <h2>Sales Dashboard</h2>
      <div className="stats-grid">
        <article className="card">
          <p className="muted">Daily Sales</p>
          <h3>{today}</h3>
        </article>
        <article className="card">
          <p className="muted">Weekly Sales</p>
          <h3>{weeks}</h3>
        </article>
        <article className="card">
          <p className="muted">Monthly Sales</p>
          <h3>${totalSales.toLocaleString()}</h3>
        </article>
        <article className="card">
          <p className="muted">Yearly Sales</p>
          <h3>{year}</h3>
        </article>
      </div>

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
        <h3>Tax Return Preparation (Preview)</h3>
        <p className="muted">
          This module is ready for future expansion: attach expenses, categorize deductible items, and
          generate tax return snapshots.
        </p>
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

  return (
    <section>
      <h2>Company Profile</h2>
      <p className="muted">Mock form now. Later this maps to DynamoDB company table.</p>
      <div className="form-grid">
        {Object.entries(profile).map(([key, value]) => (
          <label key={key}>
            {key}
            <input value={value} onChange={(e) => setValue(key as keyof CompanyProfile, e.target.value)} />
          </label>
        ))}
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

  const addItem = () => {
    if (!name.trim()) return
    const next: CatalogItem = {
      id: Date.now(),
      type,
      name,
      unit,
      defaultPrice: price,
      taxRate: 13,
    }
    setCatalog([...catalog, next])
    setName('')
    setPrice(0)
  }

  return (
    <section>
      <h2>Items & Services Library</h2>
      <p className="muted">Choose once, reuse during invoice creation with quantity or hours.</p>
      <div className="row">
        <input placeholder="Item/Service name" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" placeholder="Default price" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        <select value={type} onChange={(e) => setType(e.target.value as CatalogItem['type'])}>
          <option>Service</option>
          <option>Product</option>
        </select>
        <select value={unit} onChange={(e) => setUnit(e.target.value as CatalogItem['unit'])}>
          <option>Hour</option>
          <option>Unit</option>
        </select>
        <button onClick={addItem}>Add</button>
      </div>

      <div className="table">
        {catalog.map((item) => (
          <div key={item.id} className="table-row">
            <span>{item.name}</span>
            <span>{item.type}</span>
            <span>{item.unit}</span>
            <span>${item.defaultPrice.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function CreateInvoicePage({
  clientName,
  setClientName,
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
  catalog: CatalogItem[]
  addCatalogItem: (id: number) => void
  draftLines: DraftInvoiceLine[]
  updateLine: (index: number, key: 'quantity' | 'customPrice', value: number) => void
  removeLine: (index: number) => void
  totals: { subTotal: number; taxTotal: number; grandTotal: number }
  exportPdf: () => void
}) {
  return (
    <section>
      <h2>Create Invoice</h2>
      <div className="row">
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" />
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
      </div>

      <div className="table">
        {draftLines.map((line, index) => (
          <div key={`${line.id}-${index}`} className="table-row">
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
            <span>${(line.quantity * line.customPrice).toFixed(2)}</span>
            <button onClick={() => removeLine(index)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="totals">
        <p>Subtotal: ${totals.subTotal.toFixed(2)}</p>
        <p>Tax: ${totals.taxTotal.toFixed(2)}</p>
        <h3>Total: ${totals.grandTotal.toFixed(2)}</h3>
      </div>

      <button className="primary" onClick={exportPdf}>
        Export PDF
      </button>
      <p className="muted">Next backend phase: save PDF to S3 and invoice records to DynamoDB.</p>
    </section>
  )
}

export default App
