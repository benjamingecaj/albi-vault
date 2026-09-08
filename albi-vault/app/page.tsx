'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { vaultApi } from '@/lib/vault-api'

type Profile = { id: string; email: string; role: 'admin'|'viewer'; active: boolean }
type Credential = { id:string; brand_id:string; platform:string; login_url:string|null; username:string|null; recovery_email:string|null; has_2fa:boolean; notes:string|null; updated_at:string; vault_brands?:{name:string}|null }
type Brand = { id:string; name:string; active:boolean }
type TeamUser = { id:string; email:string; role:'admin'|'viewer'; active:boolean; created_at:string }
type ImportRow = { brand:string; platform:string; login_url:string; username:string; password:string; recovery_email:string; has_2fa:boolean; notes:string }
type Activity = {
  id:number
  user_id:string|null
  action:string
  credential_id:string|null
  brand_id:string|null
  metadata:Record<string,unknown>|null
  created_at:string
  email:string|null
  vault_brands?:{name:string}|{name:string}[]|null
  vault_credentials?:{platform:string;username:string|null}|{platform:string;username:string|null}[]|null
}

const ALLOWED_EMAIL_DOMAINS = [
  'albigroup.com',
  'albionline.com',
  'albifashion.com',
  'albicommerce.com',
  'albimarket.com',
  'albicenter.com',
]

const UNIT_SHEETS = ['Retail', 'JAROMA', 'DDO', 'NAN', 'Fashion', 'ALBI GROUP']

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

function oneJoin<T>(value:T|T[]|null|undefined):T|null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] || null) : value
}

function activityLabel(action:string) {
  const labels:Record<string,string> = {
    auth_sign_in: 'Signed in',
    auth_sign_up: 'Signed up',
    password_release: 'Password released',
    credential_reveal: 'Password revealed (legacy)',
    credential_create: 'Credential created',
    credential_import: 'Credentials imported',
    credential_disable: 'Credential disabled',
    user_create: 'User created',
  }
  return labels[action] || action.replaceAll('_',' ')
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
  const [revealed, setRevealed] = useState<Record<string,string>>({})
  const [selectedId, setSelectedId] = useState<string|null>(null)
  const [tab, setTab] = useState<'vault'|'admin'|'import'|'users'|'activity'>('vault')
  const [message, setMessage] = useState('')

  async function load() {
    try {
      const me = await vaultApi<{profile:Profile}>('me')
      setProfile(me.profile)
      if (me.profile.role === 'admin') {
        const snap = await vaultApi<{credentials:Credential[];brands:Brand[];profiles:TeamUser[]}>('admin_snapshot')
        setCredentials(snap.credentials)
        setBrands(snap.brands)
        setUsers(snap.profiles)
      } else {
        const data = await vaultApi<{credentials:Credential[]}>('list')
        setCredentials(data.credentials)
      }
    } catch {
      setProfile(null)
    } finally { setReady(true) }
  }

  async function loadActivity() {
    try {
      const data = await vaultApi<{activity:Activity[]}>('activity_log')
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
    setProfile(null); setCredentials([]); setUsers([]); setBrands([]); setActivities([])
  }

  async function releasePassword(c:Credential) {
    if (revealed[c.id]) {
      setRevealed(v => { const n={...v}; delete n[c.id]; return n })
      return
    }

    const brand = c.vault_brands?.name || 'this brand'
    const ok = window.confirm(`Release the password for ${brand} / ${c.platform}? This action will be recorded in the audit log.`)
    if (!ok) return

    try {
      const data = await vaultApi<{password:string}>('release_password', { id: c.id })
      setRevealed(v => ({...v,[c.id]:data.password}))
      setMessage('Password released. This action has been recorded in the audit log.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not release password')
    }
  }

  if (!ready) return <main className="center-page"><div className="card login-card"><h1>ALBI VAULT</h1><p className="muted">Loading secure vault…</p></div></main>
  if (!profile) return <Login />

  const filtered = credentials.filter(c => [c.vault_brands?.name,c.platform,c.username,c.recovery_email,c.notes].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()))

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">ALBI GROUP</div><h1>Credential Vault</h1></div>
      <div className="top-actions"><span className="pill">{profile.role === 'admin' ? 'Administrator' : 'Viewer'}</span><button className="btn" onClick={signOut}>Sign out</button></div>
    </header>

    {profile.role === 'admin' && <nav className="tabs">
      <button className={tab==='vault'?'active':''} onClick={()=>setTab('vault')}>Vault</button>
      <button className={tab==='admin'?'active':''} onClick={()=>setTab('admin')}>Add credential</button>
      <button className={tab==='import'?'active':''} onClick={()=>setTab('import')}>Import Excel</button>
      <button className={tab==='users'?'active':''} onClick={()=>setTab('users')}>Users</button>
      <button className={tab==='activity'?'active':''} onClick={async()=>{setTab('activity'); await loadActivity()}}>Activity Log</button>
    </nav>}

    {message && <div className="notice">{message}</div>}

    {tab === 'vault' && <>
      <div className="toolbar"><input className="input" placeholder="Search brand, platform or username…" value={query} onChange={e=>{setQuery(e.target.value);setSelectedId(null)}} /></div>
      <section className="grid">
        {filtered.map(c => {
          const opened = selectedId === c.id
          const password = revealed[c.id]
          return <article className="card credential" key={c.id}>
            <div className="cred-head"><div><div className="badge">{c.vault_brands?.name || 'Brand'}</div><h3>{c.platform}</h3></div><span className="badge">{c.has_2fa?'2FA ✓':'2FA —'}</span></div>
            <div className="meta-row"><span>Username</span><strong>{c.username || '—'}</strong></div>

            {!opened && <button className="btn dark" onClick={()=>setSelectedId(c.id)}>Open credential</button>}

            {opened && <div className="meta">
              <div className="meta-row"><span>Password</span><code>{password || '••••••••••••'}</code></div>
              <div className="meta-row"><span>Recovery</span><span>{c.recovery_email || '—'}</span></div>
              {c.notes && <div className="meta-row"><span>Notes</span><span>{c.notes}</span></div>}

              <div className="top-actions">
                <button className="btn dark" onClick={()=>releasePassword(c)}>{password ? 'Hide password' : 'Release password'}</button>
                <button className="btn" onClick={()=>{setSelectedId(null); if(password) setRevealed(v=>{const n={...v}; delete n[c.id]; return n})}}>Close</button>
                {c.login_url && <a className="btn" href={c.login_url} target="_blank" rel="noreferrer">Open login</a>}
              </div>
              <p className="tiny muted">Every password release is recorded with the user, brand/account and timestamp.</p>
            </div>}
          </article>
        })}
      </section>
    </>}

    {profile.role==='admin' && tab==='admin' && <AddCredential brands={brands} onDone={async()=>{setMessage('Credential saved.'); await load(); setTab('vault')}} />}
    {profile.role==='admin' && tab==='import' && <ImportPanel onDone={async(n)=>{setMessage(`Imported ${n} credentials.`); await load(); setTab('vault')}} />}
    {profile.role==='admin' && tab==='users' && <UsersPanel users={users} onDone={load} />}
    {profile.role==='admin' && tab==='activity' && <ActivityPanel activities={activities} onRefresh={loadActivity} />}
  </main>
}

function Login() {
  const supabase = useMemo(() => createClient(), [])
  const [mode,setMode]=useState<'login'|'signup'>('login')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(false)

  async function submit(e:React.FormEvent) {
    e.preventDefault(); setLoading(true); setMessage('')
    try {
      if (!isAllowedEmail(email)) throw new Error('Only approved ALBI company email domains are allowed.')
      const result = mode==='login'
        ? await supabase.auth.signInWithPassword({email,password})
        : await supabase.auth.signUp({email,password})
      if (result.error) throw result.error
      if (mode==='signup' && !result.data.session) setMessage('Account created. Check your email if confirmation is required, then sign in.')
    } catch(e){ setMessage(e instanceof Error?e.message:'Authentication failed') }
    finally{ setLoading(false) }
  }

  return <main className="center-page"><section className="card login-card"><div className="eyebrow">ALBI GROUP</div><h1>Credential Vault</h1><p className="muted">Private access for authorized ALBI Group staff.</p><form onSubmit={submit} className="form"><label>Email<input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@albigroup.com" required /></label><label>Password<input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label>{message&&<div className="notice">{message}</div>}<button className="btn dark" disabled={loading}>{loading?'Please wait…':mode==='login'?'Sign in':'Create first account'}</button></form><button className="linkbtn login-switch" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'First time? Create an account':'Already have an account? Sign in'}</button><p className="tiny muted">The first approved ALBI company account created becomes the administrator. Later staff accounts are created by the admin.</p></section></main>
}

function AddCredential({brands,onDone}:{brands:Brand[];onDone:()=>void}) {
  const [message,setMessage]=useState('')
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const obj=Object.fromEntries(f.entries());try{await vaultApi('add_credential',{brand:String(obj.brand||''),platform:String(obj.platform||''),login_url:String(obj.login_url||''),username:String(obj.username||''),password:String(obj.password||''),recovery_email:String(obj.recovery_email||''),notes:String(obj.notes||''),has_2fa:obj.has_2fa==='on'});onDone()}catch(e){setMessage(e instanceof Error?e.message:'Save failed')}}
  return <section className="card section"><h2>Add credential</h2><form onSubmit={submit} className="form"><div className="two-col"><label>Brand<input className="input" name="brand" list="brand-list" required /><datalist id="brand-list">{brands.map(b=><option value={b.name} key={b.id}/>)}</datalist></label><label>Platform<input className="input" name="platform" placeholder="Instagram" required /></label><label>Login URL<input className="input" name="login_url" placeholder="https://…" /></label><label>Username / email<input className="input" name="username" /></label><label>Password<input className="input" type="password" name="password" required /></label><label>Recovery email<input className="input" name="recovery_email" /></label></div><label>Notes<textarea className="textarea" name="notes" rows={3}/></label><label className="check"><input type="checkbox" name="has_2fa" /> 2FA enabled</label>{message&&<div className="notice">{message}</div>}<button className="btn dark">Save encrypted credential</button></form></section>
}

function ImportPanel({onDone}:{onDone:(n:number)=>void}) {
  const [file,setFile]=useState<File|null>(null)
  const [rows,setRows]=useState<ImportRow[]>([])
  const [cardsFound,setCardsFound]=useState(0)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)

  async function analyze() {
    if (!file) { setMessage('Choose an Excel workbook first.'); return }
    setBusy(true); setMessage(''); setRows([]); setCardsFound(0)

    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      let workbook: any
      try {
        workbook = XLSX.read(buffer, { type: 'array', raw: false })
      } catch {
        throw new Error('This Excel file is password-protected. Open it in Excel, save a temporary copy without the workbook password, and upload that copy here.')
      }

      const sheetRows = (name:string) => {
        const sheet = workbook.Sheets[name]
        if (!sheet) return [] as unknown[][]
        return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
      }

      const all = sheetRows('ALL')
      if (all.length < 2) throw new Error('The workbook does not contain the expected ALL sheet.')

      const unitByRow = new Map<string,string>()
      for (const unit of UNIT_SHEETS) {
        for (const r of sheetRows(unit).slice(1)) {
          if (!r?.length) continue
          const brand = cleanCell(r[0])
          const handle = cleanCell(r[1])
          if (brand) unitByRow.set(rowKey(brand,handle), unit)
        }
      }

      const online2fa = new Map<string,string>()
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
        const unit = unitByRow.get(rowKey(brand,handle)) || ''

        if (brand.toUpperCase() === 'DROPLET DIGITAL OCEAN' && !accountPassword && usableSecret(handle)) {
          accountPassword = handle
          handle = ''
        }

        const platform = inferPlatform(brand,handle)
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
            notes: makeNotes([unit ? `Business unit: ${unit}` : '',twofa ? `2FA status: ${twofa}` : '',info1,info2,'Imported from INFO workbook'])
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
            notes: makeNotes([unit ? `Business unit: ${unit}` : '',handle ? `Associated account: ${handle}` : '','Imported from INFO workbook'])
          })
        }
      }

      const cards = sheetRows('CARDS').slice(1).filter(r => r?.some(v => cleanCell(v)))
      setCardsFound(cards.length)
      setRows(mapped)
      setMessage(`Workbook analyzed successfully. ${mapped.length} encrypted credential records are ready to import.${cards.length ? ` ${cards.length} card-reference rows were detected and will be kept separate for the Cards module.` : ''}`)
    } catch(e) {
      setMessage(e instanceof Error ? e.message : 'Could not read workbook.')
    } finally { setBusy(false) }
  }

  async function importRows() {
    if (!rows.length) { setMessage('Analyze the Excel workbook first.'); return }
    if (!window.confirm(`Import ${rows.length} credential records? Importing the same workbook twice will create duplicates.`)) return

    setBusy(true); setMessage('')
    try {
      const data = await vaultApi<{imported:number;errors:{row:number;error:string}[]}>('import',{rows})
      if (data.errors?.length) setMessage(`${data.imported} imported; ${data.errors.length} row(s) failed.`)
      else onDone(data.imported)
    } catch(e) {
      setMessage(e instanceof Error?e.message:'Import failed')
    } finally { setBusy(false) }
  }

  return <section className="card section"><h2>Import ALBI Excel workbook</h2><p className="muted">Upload the INFO workbook and ALBI VAULT will map the existing sheets automatically. Passwords are sent to the secure backend and encrypted before storage.</p><div className="form"><label>Excel workbook<input className="input" type="file" accept=".xlsx,.xls" onChange={e=>{setFile(e.target.files?.[0]||null);setRows([]);setMessage('')}} /></label><div className="top-actions"><button className="btn" type="button" onClick={analyze} disabled={busy || !file}>{busy?'Please wait…':'Analyze workbook'}</button>{rows.length>0 && <button className="btn dark" type="button" onClick={importRows} disabled={busy}>Import {rows.length} credentials</button>}</div>{rows.length>0 && <div className="notice"><strong>Ready:</strong> {rows.length} credential records.{cardsFound>0 && <> The workbook also contains {cardsFound} payment-card reference rows; those are intentionally not mixed into the credentials table.</>}</div>}{message && <div className="notice">{message}</div>}<p className="tiny muted">Password-encrypted Excel files must first be saved as a temporary unlocked copy before browser upload.</p></div></section>
}

function UsersPanel({users,onDone}:{users:TeamUser[];onDone:()=>void}){
  const [message,setMessage]=useState('')
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);try{await vaultApi('create_user',{email:f.get('email'),password:f.get('password'),role:f.get('role')});setMessage('User created successfully.');e.currentTarget.reset();await onDone()}catch(e){setMessage(e instanceof Error?e.message:'User creation failed')}}
  return <section className="card section"><h2>Team access</h2><form className="form" onSubmit={submit}><div className="three-col"><label>Email<input className="input" name="email" type="email" placeholder="name@albigroup.com" required /></label><label>Temporary password<input className="input" name="password" type="password" minLength={12} required /></label><label>Role<select className="select" name="role"><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label></div><button className="btn dark">Create staff account</button></form>{message&&<div className="notice">{message}</div>}<div className="table-wrap"><table className="table"><thead><tr><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{u.active?'Active':'Disabled'}</td></tr>)}</tbody></table></div></section>
}

function ActivityPanel({activities,onRefresh}:{activities:Activity[];onRefresh:()=>Promise<void>}) {
  const [q,setQ]=useState('')
  const rows = activities.filter(a => {
    const brand = oneJoin(a.vault_brands)?.name || String(a.metadata?.brand || '')
    const credential = oneJoin(a.vault_credentials)
    return [a.email,a.action,brand,credential?.platform,credential?.username,String(a.metadata?.platform||''),String(a.metadata?.username||'')].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase())
  })

  return <section className="card section"><div className="topbar"><div><h2>Activity Log</h2><p className="muted">Audit history for sign-ins, sign-ups, password releases and administrative actions.</p></div><button className="btn" onClick={onRefresh}>Refresh log</button></div><div className="toolbar"><input className="input" placeholder="Search user, brand, platform or action…" value={q} onChange={e=>setQ(e.target.value)} /></div><div className="table-wrap"><table className="table"><thead><tr><th>Date / time</th><th>User</th><th>Action</th><th>Brand / account</th><th>Details</th></tr></thead><tbody>{rows.map(a=>{const brand=oneJoin(a.vault_brands)?.name || String(a.metadata?.brand||'—');const cred=oneJoin(a.vault_credentials);const platform=cred?.platform || String(a.metadata?.platform||'');const username=cred?.username || String(a.metadata?.username||'');const ip=String(a.metadata?.ip||'');return <tr key={a.id}><td>{new Date(a.created_at).toLocaleString()}</td><td>{a.email || '—'}</td><td><strong>{activityLabel(a.action)}</strong></td><td>{brand}{platform ? ` / ${platform}` : ''}</td><td>{username || '—'}{ip ? ` · IP ${ip}` : ''}</td></tr>})}</tbody></table></div>{!rows.length && <p className="muted">No matching log entries.</p>}</section>
}
