'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { vaultApi } from '@/lib/vault-api'

type Profile = { id: string; email: string; role: 'admin' | 'viewer'; active: boolean }
type Credential = {
  id: string
  brand_id: string
  platform: string
  login_url: string | null
  username: string | null
  recovery_email: string | null
  has_2fa: boolean
  notes: string | null
  updated_at: string
  vault_brands?: { name: string } | null
}
type Brand = { id: string; name: string; active: boolean }
type TeamUser = { id: string; email: string; role: 'admin' | 'viewer'; active: boolean; created_at: string }
type ImportRow = {
  brand: string
  platform: string
  login_url: string
  username: string
  password: string
  recovery_email: string
  has_2fa: boolean
  notes: string
}
type Activity = {
  id: number
  user_id: string | null
  action: string
  credential_id: string | null
  brand_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  email: string | null
  vault_brands?: { name: string } | { name: string }[] | null
  vault_credentials?: { platform: string; username: string | null } | { platform: string; username: string | null }[] | null
}

const ALLOWED_EMAIL_DOMAINS = [
  'albigroup.com',
  'albionline.com',
  'albifashion.com',
  'albicommerce.com',
  'albimarket.com',
  'albicenter.com',
]

const UNIT_SHEETS = ['Retail', 'JAROMA', 'DDO', 'NAN', 'Fashion', 'ALBI GROUP'] as const

function isAllowedEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  return ALLOWED_EMAIL_DOMAINS.some(domain => normalized.endsWith(`@${domain}`))
}

function cleanCell(value: unknown) {
  let s = String(value ?? '').trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim()
  return s
}

function usableSecret(value: unknown) {
  const s = cleanCell(value)
  if (!s) return false
  const placeholders = new Set(['N/A', 'IT DEPARTMENT', 'CHANGES AHEAD'])
  return !placeholders.has(s.toUpperCase())
}

function is2FAEnabled(value: unknown) {
  const s = cleanCell(value).toUpperCase()
  return s.startsWith('YES') || s === 'TRUE' || s === '1' || s.includes('AUTHENTICATOR')
}

function rowKey(brand: unknown, handle: unknown) {
  return `${cleanCell(brand).toLowerCase()}|${cleanCell(handle).toLowerCase()}`
}

function inferPlatform(brand: string, handle: string) {
  const probe = `${brand} ${handle}`.toLowerCase()
  if (probe.includes('tiktok')) return 'TikTok'
  if (probe.includes('facebook')) return 'Facebook'
  if (probe.includes('hubspot')) return 'HubSpot'
  if (probe.includes('mailchimp')) return 'MailChimp'
  if (probe.includes('hetzner')) return 'Hetzner'
  if (probe.includes('bitbucket')) return 'BitBucket'
  if (probe.includes('apple developer')) return 'Apple Developer'
  if (probe.includes('godaddy')) return 'GoDaddy'
  if (probe.includes('google console')) return 'Google Console'
  if (probe.includes('trustpilot')) return 'Trustpilot'
  if (probe.includes('digital ocean') || probe.includes('droplet')) return 'DigitalOcean'
  if (probe.includes('mongodb')) return 'MongoDB'
  if (probe.includes('cloudflare')) return 'Cloudflare'
  if (probe.includes('shopify')) return 'Shopify'
  if (probe.includes('google')) return 'Google'
  if (probe.includes('info albi online')) return 'Email'
  return 'Instagram'
}

function makeNotes(parts: Array<string | null | undefined>) {
  return parts.map(p => (p || '').trim()).filter(Boolean).join(' · ')
}

function instagramUrl(handle: string) {
  if (!handle || handle.toUpperCase() === 'N/A' || handle.toLowerCase().includes('facebook account')) return ''
  return `https://instagram.com/${handle.replace(/^@/, '')}`
}

function oneJoin<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] || null) : value
}

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    auth_sign_in: 'Signed in',
    auth_sign_up: 'Signed up',
    password_release: 'Password released',
    credential_reveal: 'Password revealed (legacy)',
    credential_create: 'Credential created',
    credential_import: 'Credentials imported',
    credential_disable: 'Credential disabled',
    user_create: 'User created',
  }
  return labels[action] || action.replaceAll('_', ' ')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatAgo(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  const units = [
    { label: 'day', secs: 86400 },
    { label: 'hour', secs: 3600 },
    { label: 'minute', secs: 60 },
  ]
  for (const unit of units) {
    if (diff >= unit.secs) {
      const amount = Math.floor(diff / unit.secs)
      return `${amount} ${unit.label}${amount === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

function platformAccent(platform: string) {
  const value = platform.toLowerCase()
  if (value.includes('instagram')) return { label: 'IG', tone: 'pink' }
  if (value.includes('facebook')) return { label: 'FB', tone: 'blue' }
  if (value.includes('tiktok')) return { label: 'TT', tone: 'dark' }
  if (value.includes('google')) return { label: 'G', tone: 'amber' }
  if (value.includes('cloudflare')) return { label: 'CF', tone: 'orange' }
  if (value.includes('shopify')) return { label: 'S', tone: 'green' }
  if (value.includes('email')) return { label: 'EM', tone: 'slate' }
  return { label: platform.slice(0, 2).toUpperCase(), tone: 'slate' }
}

export default function Home() {
  const supabase = useMemo(() => createClient(), [])
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [users, setUsers] = useState<TeamUser[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'vault' | 'admin' | 'import' | 'users' | 'activity'>('vault')
  const [message, setMessage] = useState('')

  async function load() {
    try {
      const me = await vaultApi<{ profile: Profile }>('me')
      setProfile(me.profile)
      if (me.profile.role === 'admin') {
        const snap = await vaultApi<{ credentials: Credential[]; brands: Brand[]; profiles: TeamUser[] }>('admin_snapshot')
        setCredentials(snap.credentials)
        setBrands(snap.brands)
        setUsers(snap.profiles)
      } else {
        const data = await vaultApi<{ credentials: Credential[] }>('list')
        setCredentials(data.credentials)
      }
    } catch {
      setProfile(null)
    } finally {
      setReady(true)
    }
  }

  async function loadActivity() {
    try {
      const data = await vaultApi<{ activity: Activity[] }>('activity_log')
      setActivities(data.activity || [])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load activity log')
    }
  }

  useEffect(() => {
    load()
    const { data } = supabase.auth.onAuthStateChange(() => load())
    return () => data.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setCredentials([])
    setUsers([])
    setBrands([])
    setActivities([])
  }

  async function releasePassword(c: Credential) {
    if (revealed[c.id]) {
      setRevealed(v => {
        const next = { ...v }
        delete next[c.id]
        return next
      })
      return
    }

    const brand = c.vault_brands?.name || 'this brand'
    const ok = window.confirm(`Release the password for ${brand} / ${c.platform}? This action will be recorded in the audit log.`)
    if (!ok) return

    try {
      const data = await vaultApi<{ password: string }>('release_password', { id: c.id })
      setRevealed(v => ({ ...v, [c.id]: data.password }))
      setMessage('Password released. This action has been recorded in the audit log.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not release password')
    }
  }

  if (!ready) {
    return (
      <main className="login-shell">
        <div className="login-panel">
          <div className="brand-line">ALBI GROUP</div>
          <h1>Credential Vault</h1>
          <p className="muted">Loading secure vault…</p>
        </div>
      </main>
    )
  }

  if (!profile) return <Login />

  const filtered = credentials.filter(c =>
    [c.vault_brands?.name, c.platform, c.username, c.recovery_email, c.notes]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase())
  )

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand-lockup">
            <div className="brand-small">ALBI GROUP</div>
            <div className="brand-title">Credential Vault</div>
          </div>

          <nav className="sidebar-nav">
            <button className={`nav-btn ${tab === 'vault' ? 'active' : ''}`} onClick={() => setTab('vault')}>Vault</button>
            {profile.role === 'admin' && (
              <>
                <button className={`nav-btn ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}>Add credential</button>
                <button className={`nav-btn ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>Import Excel</button>
                <button className={`nav-btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
                <button
                  className={`nav-btn ${tab === 'activity' ? 'active' : ''}`}
                  onClick={async () => {
                    setTab('activity')
                    await loadActivity()
                  }}
                >
                  Activity Log
                </button>
              </>
            )}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="profile-card">
            <div className="avatar-circle">{(profile.email?.[0] || 'A').toUpperCase()}</div>
            <div>
              <div className="profile-name">{profile.email}</div>
              <div className="profile-sub">{profile.role === 'admin' ? 'Administrator' : 'Viewer'}</div>
            </div>
          </div>
          <button className="ghost-btn" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <section className="content-shell">
        <header className="page-topbar">
          <div>
            <h1>{tab === 'vault' ? 'Credential Vault' : tab === 'admin' ? 'Add credential' : tab === 'import' ? 'Import Excel' : tab === 'users' ? 'Team users' : 'Activity Log'}</h1>
            <p className="muted">
              {tab === 'vault' && 'A structured table view for all brand credentials.'}
              {tab === 'admin' && 'Manually add a new credential into the encrypted vault.'}
              {tab === 'import' && 'Upload and map the ALBI Excel workbook.'}
              {tab === 'users' && 'Create and monitor ALBI VAULT user accounts.'}
              {tab === 'activity' && 'Audit trail for sign-ins, sign-ups, password releases, and admin actions.'}
            </p>
          </div>

          <div className="topbar-right">
            <span className="status-pill">{profile.role === 'admin' ? 'Administrator' : 'Viewer'}</span>
          </div>
        </header>

        {message && (
          <div className="banner success">
            <span className="banner-icon">✓</span>
            <span>{message}</span>
            <button className="banner-close" onClick={() => setMessage('')}>×</button>
          </div>
        )}

        {tab === 'vault' && (
          <VaultTable
            credentials={filtered}
            query={query}
            setQuery={setQuery}
            revealed={revealed}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            releasePassword={releasePassword}
          />
        )}

        {profile.role === 'admin' && tab === 'admin' && (
          <AddCredential
            brands={brands}
            onDone={async () => {
              setMessage('Credential saved successfully.')
              await load()
              setTab('vault')
            }}
          />
        )}

        {profile.role === 'admin' && tab === 'import' && (
          <ImportPanel
            onDone={async imported => {
              setMessage(`Imported ${imported} credentials.`)
              await load()
              setTab('vault')
            }}
          />
        )}

        {profile.role === 'admin' && tab === 'users' && <UsersPanel users={users} onDone={load} />}

        {profile.role === 'admin' && tab === 'activity' && <ActivityPanel activities={activities} onRefresh={loadActivity} />}
      </section>
    </main>
  )
}

function Login() {
  const supabase = useMemo(() => createClient(), [])
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      if (!isAllowedEmail(email)) throw new Error('Only approved ALBI company email domains are allowed.')
      const result =
        mode === 'login'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password })
      if (result.error) throw result.error
      if (mode === 'signup' && !result.data.session) {
        setMessage('Account created. Check your email if confirmation is required, then sign in.')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-line">ALBI GROUP</div>
        <h1>Credential Vault</h1>
        <p className="muted">Private access for authorized ALBI Group staff.</p>

        <form onSubmit={submit} className="stack-form">
          <label>
            Email
            <input className="field" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@albigroup.com" required />
          </label>

          <label>
            Password
            <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
          </label>

          {message && <div className="inline-note">{message}</div>}
          <button className="primary-btn" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create first account'}</button>
        </form>

        <button className="link-btn" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'First time? Create an account' : 'Already have an account? Sign in'}
        </button>

        <p className="help-copy">
          The first approved ALBI company account created becomes the administrator. Later staff accounts are created by the admin.
        </p>
      </section>
    </main>
  )
}

function VaultTable({
  credentials,
  query,
  setQuery,
  revealed,
  selectedId,
  setSelectedId,
  releasePassword,
}: {
  credentials: Credential[]
  query: string
  setQuery: (v: string) => void
  revealed: Record<string, string>
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  releasePassword: (credential: Credential) => Promise<void>
}) {
  return (
    <section className="panel">
      <div className="toolbar-row">
        <input
          className="field search-field"
          placeholder="Search brand, platform, username or notes..."
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setSelectedId(null)
          }}
        />
        <div className="toolbar-meta">{credentials.length} credentials</div>
      </div>

      <div className="table-card">
        <table className="vault-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Platform</th>
              <th>Username</th>
              <th>2FA</th>
              <th>Status</th>
              <th>Last updated</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {credentials.map(c => {
              const accent = platformAccent(c.platform)
              const isOpen = selectedId === c.id
              const password = revealed[c.id]
              return (
                <>
                  <tr key={c.id} className="row-main">
                    <td>
                      <div className="cell-brand">
                        <span className={`platform-badge ${accent.tone}`}>{accent.label}</span>
                        <div>
                          <div className="cell-title">{c.vault_brands?.name || 'Brand'}</div>
                          <div className="cell-subtitle">{c.recovery_email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>{c.platform}</td>
                    <td>{c.username || '—'}</td>
                    <td><span className={`mini-pill ${c.has_2fa ? 'ok' : 'muted-pill'}`}>{c.has_2fa ? 'Enabled' : 'Not enabled'}</span></td>
                    <td><span className="mini-pill active-pill">Active</span></td>
                    <td>{formatAgo(c.updated_at)}</td>
                    <td className="align-right">
                      <button className="table-action-btn" onClick={() => setSelectedId(isOpen ? null : c.id)}>
                        {isOpen ? 'Close' : 'Open'}
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="row-expand" key={`${c.id}-expand`}>
                      <td colSpan={7}>
                        <div className="expand-card">
                          <div className="expand-left">
                            <div className="expand-header">
                              <span className={`platform-badge ${accent.tone}`}>{accent.label}</span>
                              <div>
                                <h3>{c.platform}</h3>
                                <p>{c.vault_brands?.name || 'Brand account'}</p>
                              </div>
                            </div>

                            <div className="detail-grid">
                              <div className="detail-row"><span>Username</span><strong>{c.username || '—'}</strong></div>
                              <div className="detail-row"><span>Password</span><code>{password || '••••••••••••'}</code></div>
                              <div className="detail-row"><span>Recovery email</span><span>{c.recovery_email || '—'}</span></div>
                              <div className="detail-row"><span>2FA</span><span>{c.has_2fa ? 'Enabled' : 'Not enabled'}</span></div>
                              <div className="detail-row full"><span>Notes</span><span>{c.notes || '—'}</span></div>
                            </div>
                          </div>

                          <div className="expand-right">
                            <div className="mini-stats">
                              <div><span>Status</span><strong>Active</strong></div>
                              <div><span>Updated</span><strong>{formatDate(c.updated_at)}</strong></div>
                            </div>

                            <button className="primary-btn" onClick={() => releasePassword(c)}>
                              {password ? 'Hide password' : 'Release password'}
                            </button>

                            {c.login_url && (
                              <a className="secondary-link" href={c.login_url} target="_blank" rel="noreferrer">
                                Open login page
                              </a>
                            )}

                            <p className="help-copy small">Every password release is recorded in the audit log with the user, credential, and timestamp.</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}

            {!credentials.length && (
              <tr>
                <td colSpan={7} className="empty-state">
                  No credentials match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AddCredential({ brands, onDone }: { brands: Brand[]; onDone: () => void }) {
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const obj = Object.fromEntries(f.entries())

    try {
      await vaultApi('add_credential', {
        brand: String(obj.brand || ''),
        platform: String(obj.platform || ''),
        login_url: String(obj.login_url || ''),
        username: String(obj.username || ''),
        password: String(obj.password || ''),
        recovery_email: String(obj.recovery_email || ''),
        notes: String(obj.notes || ''),
        has_2fa: obj.has_2fa === 'on',
      })
      onDone()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Add credential</h2>
        <p className="muted">Create a new encrypted credential entry.</p>
      </div>

      <form onSubmit={submit} className="form-card">
        <div className="form-grid two">
          <label>Brand
            <input className="field" name="brand" list="brand-list" required />
            <datalist id="brand-list">
              {brands.map(b => <option value={b.name} key={b.id} />)}
            </datalist>
          </label>

          <label>Platform
            <input className="field" name="platform" placeholder="Instagram" required />
          </label>

          <label>Login URL
            <input className="field" name="login_url" placeholder="https://..." />
          </label>

          <label>Username / email
            <input className="field" name="username" />
          </label>

          <label>Password
            <input className="field" type="password" name="password" required />
          </label>

          <label>Recovery email
            <input className="field" name="recovery_email" />
          </label>
        </div>

        <label>Notes
          <textarea className="field textarea" name="notes" rows={4} />
        </label>

        <label className="inline-check">
          <input type="checkbox" name="has_2fa" /> 2FA enabled
        </label>

        {message && <div className="inline-note">{message}</div>}
        <button className="primary-btn">Save encrypted credential</button>
      </form>
    </section>
  )
}

function ImportPanel({ onDone }: { onDone: (count: number) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [cardsFound, setCardsFound] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function analyze() {
    if (!file) {
      setMessage('Choose an Excel workbook first.')
      return
    }

    setBusy(true)
    setMessage('')
    setRows([])
    setCardsFound(0)

    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      let workbook: any

      try {
        workbook = XLSX.read(buffer, { type: 'array', raw: false })
      } catch {
        throw new Error('This Excel file is password-protected. Open it in Excel, save a temporary copy without the workbook password, and upload that copy here.')
      }

      const sheetRows = (name: string) => {
        const sheet = workbook.Sheets[name]
        if (!sheet) return [] as unknown[][]
        return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
      }

      const all = sheetRows('ALL')
      if (all.length < 2) throw new Error('The workbook does not contain the expected ALL sheet.')

      const unitByRow = new Map<string, string>()
      for (const unit of UNIT_SHEETS) {
        for (const r of sheetRows(unit).slice(1)) {
          if (!r?.length) continue
          const brand = cleanCell(r[0])
          const handle = cleanCell(r[1])
          if (brand) unitByRow.set(rowKey(brand, handle), unit)
        }
      }

      const online2fa = new Map<string, string>()
      for (const r of sheetRows('Albi Online').slice(1)) {
        const network = cleanCell(r[0]).toLowerCase()
        const email = cleanCell(r[2]).toLowerCase()
        const status = cleanCell(r[4])
        if (network) online2fa.set(`${network}|${email}`, status)
      }

      const mapped: ImportRow[] = []

      for (const r of all.slice(1)) {
        if (!r?.length) continue
        const brand = cleanCell(r[0])
        let handle = cleanCell(r[1])
        const email = cleanCell(r[2])
        const emailPassword = cleanCell(r[3])
        let accountPassword = cleanCell(r[4])
        let twofa = cleanCell(r[5])
        const info1 = cleanCell(r[6])
        const info2 = cleanCell(r[7])

        if (!brand) continue
        const unit = unitByRow.get(rowKey(brand, handle)) || ''

        if (brand.toUpperCase() === 'DROPLET DIGITAL OCEAN' && !accountPassword && usableSecret(handle)) {
          accountPassword = handle
          handle = ''
        }

        const platform = inferPlatform(brand, handle)
        const richer2fa = online2fa.get(`${brand.toLowerCase()}|${email.toLowerCase()}`)
        if (richer2fa) twofa = richer2fa

        if (usableSecret(accountPassword)) {
          mapped.push({
            brand,
            platform,
            login_url: platform === 'Instagram' ? instagramUrl(handle) : '',
            username: handle && handle.toUpperCase() !== 'N/A' ? handle : (platform === 'Email' ? email : ''),
            password: accountPassword,
            recovery_email: email,
            has_2fa: is2FAEnabled(twofa),
            notes: makeNotes([
              unit ? `Business unit: ${unit}` : '',
              twofa ? `2FA status: ${twofa}` : '',
              info1,
              info2,
              'Imported from INFO workbook',
            ]),
          })
        }

        if (email && usableSecret(emailPassword)) {
          mapped.push({
            brand,
            platform: 'Email',
            login_url: '',
            username: email,
            password: emailPassword,
            recovery_email: '',
            has_2fa: false,
            notes: makeNotes([
              unit ? `Business unit: ${unit}` : '',
              handle ? `Associated account: ${handle}` : '',
              'Imported from INFO workbook',
            ]),
          })
        }
      }

      const cards = sheetRows('CARDS').slice(1).filter(r => r?.some(v => cleanCell(v)))
      setCardsFound(cards.length)
      setRows(mapped)
      setMessage(`Workbook analyzed successfully. ${mapped.length} encrypted credential records are ready to import.${cards.length ? ` ${cards.length} card-reference rows were detected and will be kept separate for the Cards module.` : ''}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read workbook.')
    } finally {
      setBusy(false)
    }
  }

  async function importRows() {
    if (!rows.length) {
      setMessage('Analyze the Excel workbook first.')
      return
    }

    if (!window.confirm(`Import ${rows.length} credential records? Importing the same workbook twice will create duplicates.`)) return

    setBusy(true)
    setMessage('')

    try {
      const data = await vaultApi<{ imported: number; errors: { row: number; error: string }[] }>('import', { rows })
      if (data.errors?.length) setMessage(`${data.imported} imported; ${data.errors.length} row(s) failed.`)
      else onDone(data.imported)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Import ALBI Excel workbook</h2>
        <p className="muted">Upload the INFO workbook and ALBI VAULT will map the existing sheets automatically.</p>
      </div>

      <div className="form-card">
        <label>Excel workbook
          <input className="field" type="file" accept=".xlsx,.xls" onChange={e => {
            setFile(e.target.files?.[0] || null)
            setRows([])
            setMessage('')
          }} />
        </label>

        <div className="button-row">
          <button className="secondary-btn" type="button" onClick={analyze} disabled={busy || !file}>
            {busy ? 'Please wait…' : 'Analyze workbook'}
          </button>

          {rows.length > 0 && (
            <button className="primary-btn" type="button" onClick={importRows} disabled={busy}>
              Import {rows.length} credentials
            </button>
          )}
        </div>

        {rows.length > 0 && (
          <div className="inline-note">
            <strong>Ready:</strong> {rows.length} credential records.
            {cardsFound > 0 && <> The workbook also contains {cardsFound} card-reference rows; those are intentionally not mixed into the credentials table.</>}
          </div>
        )}

        {message && <div className="inline-note">{message}</div>}
        <p className="help-copy small">Password-encrypted Excel files must first be saved as a temporary unlocked copy before browser upload.</p>
      </div>
    </section>
  )
}

function UsersPanel({ users, onDone }: { users: TeamUser[]; onDone: () => Promise<void> }) {
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await vaultApi('create_user', { email: f.get('email'), password: f.get('password'), role: f.get('role') })
      setMessage('User created successfully.')
      e.currentTarget.reset()
      await onDone()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'User creation failed')
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Team access</h2>
        <p className="muted">Create admin or viewer accounts for your internal team.</p>
      </div>

      <form className="form-card" onSubmit={submit}>
        <div className="form-grid three">
          <label>Email
            <input className="field" name="email" type="email" placeholder="name@albigroup.com" required />
          </label>

          <label>Temporary password
            <input className="field" name="password" type="password" minLength={12} required />
          </label>

          <label>Role
            <select className="field" name="role">
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>

        <button className="primary-btn">Create staff account</button>
        {message && <div className="inline-note">{message}</div>}
      </form>

      <div className="table-card">
        <table className="vault-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td><span className="mini-pill">{u.role}</span></td>
                <td><span className={`mini-pill ${u.active ? 'active-pill' : 'muted-pill'}`}>{u.active ? 'Active' : 'Disabled'}</span></td>
                <td>{formatDate(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ActivityPanel({ activities, onRefresh }: { activities: Activity[]; onRefresh: () => Promise<void> }) {
  const [q, setQ] = useState('')

  const rows = activities.filter(a => {
    const brand = oneJoin(a.vault_brands)?.name || String(a.metadata?.brand || '')
    const credential = oneJoin(a.vault_credentials)
    return [a.email, a.action, brand, credential?.platform, credential?.username, String(a.metadata?.platform || ''), String(a.metadata?.username || '')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q.toLowerCase())
  })

  return (
    <section className="panel">
      <div className="toolbar-row">
        <input className="field search-field" placeholder="Search user, brand, platform or action..." value={q} onChange={e => setQ(e.target.value)} />
        <button className="secondary-btn" onClick={onRefresh}>Refresh log</button>
      </div>

      <div className="table-card">
        <table className="vault-table">
          <thead>
            <tr>
              <th>Date / time</th>
              <th>User</th>
              <th>Action</th>
              <th>Brand / account</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const brand = oneJoin(a.vault_brands)?.name || String(a.metadata?.brand || '—')
              const cred = oneJoin(a.vault_credentials)
              const platform = cred?.platform || String(a.metadata?.platform || '')
              const username = cred?.username || String(a.metadata?.username || '')
              const ip = String(a.metadata?.ip || '')
              return (
                <tr key={a.id}>
                  <td>{formatDate(a.created_at)}</td>
                  <td>{a.email || '—'}</td>
                  <td><strong>{activityLabel(a.action)}</strong></td>
                  <td>{brand}{platform ? ` / ${platform}` : ''}</td>
                  <td>{username || '—'}{ip ? ` · IP ${ip}` : ''}</td>
                </tr>
              )
            })}

            {!rows.length && (
              <tr>
                <td colSpan={5} className="empty-state">No matching log entries.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
