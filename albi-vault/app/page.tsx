'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { vaultApi } from '@/lib/vault-api'

type Profile = { id: string; email: string; role: 'admin'|'viewer'; active: boolean }
type Credential = { id:string; brand_id:string; platform:string; login_url:string|null; username:string|null; recovery_email:string|null; has_2fa:boolean; notes:string|null; updated_at:string; vault_brands?:{name:string}|null }
type Brand = { id:string; name:string; active:boolean }
type TeamUser = { id:string; email:string; role:'admin'|'viewer'; active:boolean; created_at:string }

const ALLOWED_EMAIL_DOMAINS = [
  'albigroup.com',
  'albionline.com',
  'albifashion.com',
  'albicommerce.com',
  'albimarket.com',
  'albicenter.com',
]

function isAllowedEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  return ALLOWED_EMAIL_DOMAINS.some(domain => normalized.endsWith(`@${domain}`))
}

export default function Home() {
  const supabase = useMemo(() => createClient(), [])
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [users, setUsers] = useState<TeamUser[]>([])
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string,string>>({})
  const [tab, setTab] = useState<'vault'|'admin'|'import'|'users'>('vault')
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

  useEffect(() => {
    load()
    const { data } = supabase.auth.onAuthStateChange(() => load())
    return () => data.subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null); setCredentials([]); setUsers([]); setBrands([])
  }

  async function reveal(id:string) {
    if (revealed[id]) { setRevealed(v => { const n={...v}; delete n[id]; return n }); return }
    try {
      const data = await vaultApi<{password:string}>('reveal', { id })
      setRevealed(v => ({...v,[id]:data.password}))
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not reveal password') }
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
    </nav>}

    {message && <div className="notice">{message}</div>}

    {tab === 'vault' && <>
      <div className="toolbar"><input className="input" placeholder="Search brand, platform or username…" value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <section className="grid">
        {filtered.map(c => <article className="card credential" key={c.id}>
          <div className="cred-head"><div><div className="badge">{c.vault_brands?.name || 'Brand'}</div><h3>{c.platform}</h3></div><span className="badge">{c.has_2fa?'2FA ✓':'2FA —'}</span></div>
          <div className="meta">
            <div className="meta-row"><span>Username</span><strong>{c.username || '—'}</strong></div>
            <div className="meta-row"><span>Password</span><span className="pwbox"><code>{revealed[c.id] || '••••••••••••'}</code><button className="linkbtn" onClick={()=>reveal(c.id)}>{revealed[c.id]?'Hide':'Reveal'}</button></span></div>
            <div className="meta-row"><span>Recovery</span><span>{c.recovery_email || '—'}</span></div>
            {c.notes && <div className="meta-row"><span>Notes</span><span>{c.notes}</span></div>}
          </div>
          {c.login_url && <a className="btn dark" href={c.login_url} target="_blank" rel="noreferrer">Open login</a>}
        </article>)}
      </section>
    </>}

    {profile.role==='admin' && tab==='admin' && <AddCredential brands={brands} onDone={async()=>{setMessage('Credential saved.'); await load(); setTab('vault')}} />}
    {profile.role==='admin' && tab==='import' && <ImportPanel onDone={async(n)=>{setMessage(`Imported ${n} credentials.`); await load(); setTab('vault')}} />}
    {profile.role==='admin' && tab==='users' && <UsersPanel users={users} onDone={load} />}
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

function ImportPanel({onDone}:{onDone:(n:number)=>void}){
  const [text,setText]=useState(''); const [message,setMessage]=useState('')
  async function run(){try{const lines=text.split(/\r?\n/).filter(Boolean);if(lines.length<2)throw new Error('Paste a header row and at least one credential row.');const headers=lines.shift()!.split('\t').map(h=>h.trim().toLowerCase());const rows=lines.map(line=>{const cells=line.split('\t');return Object.fromEntries(headers.map((h,i)=>[h,cells[i]??'']))});const data=await vaultApi<{imported:number;errors:any[]}>('import',{rows});if(data.errors?.length)setMessage(`${data.imported} imported; ${data.errors.length} row(s) failed.`);else onDone(data.imported)}catch(e){setMessage(e instanceof Error?e.message:'Import failed')}}
  return <section className="card section"><h2>Import from Excel</h2><p className="muted">Copy the rows in Excel and paste them here. Headers: brand, platform, login_url, username, password, recovery_email, has_2fa, notes.</p><textarea className="textarea mono" rows={14} value={text} onChange={e=>setText(e.target.value)} placeholder={'brand\tplatform\tlogin_url\tusername\tpassword\trecovery_email\thas_2fa\tnotes'} />{message&&<div className="notice">{message}</div>}<button className="btn dark" onClick={run}>Import and encrypt</button></section>
}

function UsersPanel({users,onDone}:{users:TeamUser[];onDone:()=>void}){
  const [message,setMessage]=useState('')
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);try{await vaultApi('create_user',{email:f.get('email'),password:f.get('password'),role:f.get('role')});setMessage('User created successfully.');e.currentTarget.reset();await onDone()}catch(e){setMessage(e instanceof Error?e.message:'User creation failed')}}
  return <section className="card section"><h2>Team access</h2><form className="form" onSubmit={submit}><div className="three-col"><label>Email<input className="input" name="email" type="email" placeholder="name@albigroup.com" required /></label><label>Temporary password<input className="input" name="password" type="password" minLength={12} required /></label><label>Role<select className="select" name="role"><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label></div><button className="btn dark">Create staff account</button></form>{message&&<div className="notice">{message}</div>}<div className="table-wrap"><table className="table"><thead><tr><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{u.active?'Active':'Disabled'}</td></tr>)}</tbody></table></div></section>
}
