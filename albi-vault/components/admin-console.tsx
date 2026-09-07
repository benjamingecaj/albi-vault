'use client'

import { useMemo, useState } from 'react'

type Brand = { id: string; name: string }
type Credential = { id:string; brand_id:string; platform:string; login_url:string|null; username:string|null; recovery_email:string|null; has_2fa:boolean; notes:string|null; active:boolean; vault_brands?:{name:string}|null }
type Profile = { id:string; email:string; role:'admin'|'viewer'; active:boolean; created_at:string }

export default function AdminConsole({ initialCredentials, brands, profiles }: { initialCredentials: Credential[]; brands: Brand[]; profiles: Profile[] }) {
  const [tab, setTab] = useState<'credentials'|'import'|'users'>('credentials')
  const [credentials, setCredentials] = useState(initialCredentials)
  const [message, setMessage] = useState('')
  const [importText, setImportText] = useState('')

  async function addCredential(formData: FormData) {
    setMessage('')
    const body = Object.fromEntries(formData.entries())
    const res = await fetch('/api/admin/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) return setMessage(data.error || 'Could not save credential')
    setCredentials((v) => [data.credential, ...v])
    setMessage('Credential added.')
  }

  async function removeCredential(id: string) {
    if (!confirm('Delete this credential?')) return
    const res = await fetch(`/api/admin/credentials/${id}`, { method: 'DELETE' })
    if (res.ok) setCredentials((v) => v.filter((x) => x.id !== id))
  }

  async function runImport() {
    const rows = importText.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'))
    if (!rows.length) return
    const headers = rows.shift()!.map((h) => h.trim().toLowerCase())
    const payload = rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])))
    const res = await fetch('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: payload }) })
    const data = await res.json()
    setMessage(res.ok ? `Imported ${data.imported} credentials.` : data.error || 'Import failed')
    if (res.ok) window.location.reload()
  }

  return (
    <>
      <div className="admin-tabs">
        <button className={`btn ${tab==='credentials'?'active':''}`} onClick={() => setTab('credentials')}>Credentials</button>
        <button className={`btn ${tab==='import'?'active':''}`} onClick={() => setTab('import')}>Paste from Excel</button>
        <button className={`btn ${tab==='users'?'active':''}`} onClick={() => setTab('users')}>Users</button>
      </div>
      {message ? <div className="notice ok" style={{ marginBottom: 14 }}>{message}</div> : null}

      {tab === 'credentials' ? <>
        <section className="card section">
          <h2>Add credential</h2>
          <form action={addCredential} className="form">
            <div className="three-col">
              <div className="field"><label>Brand</label><select className="select" name="brand_id" required>{brands.map((b)=><option value={b.id} key={b.id}>{b.name}</option>)}</select></div>
              <div className="field"><label>Platform</label><input className="input" name="platform" placeholder="Instagram" required /></div>
              <div className="field"><label>Login URL</label><input className="input" name="login_url" placeholder="https://…" /></div>
              <div className="field"><label>Username / email</label><input className="input" name="username" /></div>
              <div className="field"><label>Password</label><input className="input" name="password" type="password" required /></div>
              <div className="field"><label>Recovery email</label><input className="input" name="recovery_email" /></div>
            </div>
            <div className="two-col"><div className="field"><label>Notes</label><input className="input" name="notes" /></div><label style={{display:'flex',alignItems:'center',gap:8,marginTop:26}}><input type="checkbox" name="has_2fa" value="true" /> 2FA enabled</label></div>
            <button className="btn dark" type="submit">Add credential</button>
          </form>
        </section>
        <section className="card table-wrap"><table className="table"><thead><tr><th>Brand</th><th>Platform</th><th>Username</th><th>2FA</th><th></th></tr></thead><tbody>{credentials.map((c)=><tr key={c.id}><td>{c.vault_brands?.name || '—'}</td><td>{c.platform}</td><td>{c.username || '—'}</td><td>{c.has_2fa?'Yes':'No'}</td><td><button className="btn danger" onClick={()=>removeCredential(c.id)}>Delete</button></td></tr>)}</tbody></table></section>
      </> : null}

      {tab === 'import' ? <section className="card section"><h2>Paste from Excel</h2><p className="muted small">Copy rows directly from Excel and paste them below. First row must contain headers. Supported headers: brand, platform, login_url, username, password, recovery_email, has_2fa, notes.</p><textarea className="textarea" rows={14} value={importText} onChange={(e)=>setImportText(e.target.value)} placeholder={'brand\tplatform\tlogin_url\tusername\tpassword\trecovery_email\thas_2fa\tnotes'} /><div style={{marginTop:12}}><button className="btn dark" onClick={runImport}>Import encrypted credentials</button></div></section> : null}

      {tab === 'users' ? <UsersPanel profiles={profiles} /> : null}
    </>
  )
}

function UsersPanel({ profiles }: { profiles: Profile[] }) {
  const [message, setMessage] = useState('')
  async function addUser(formData: FormData) {
    const body = Object.fromEntries(formData.entries())
    const res = await fetch('/api/admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
    const data = await res.json()
    setMessage(res.ok ? 'User created. Give them the temporary password securely.' : data.error || 'Could not create user')
  }
  return <section className="card section"><h2>Team access</h2>{message?<div className="notice ok" style={{marginBottom:14}}>{message}</div>:null}<form action={addUser} className="form"><div className="three-col"><div className="field"><label>Email</label><input className="input" name="email" placeholder="name@albigroup.com" type="email" required /></div><div className="field"><label>Temporary password</label><input className="input" name="password" type="password" minLength={12} required /></div><div className="field"><label>Role</label><select className="select" name="role"><option value="viewer">Viewer</option><option value="admin">Admin</option></select></div></div><button className="btn dark" type="submit">Create user</button></form><div className="divider"/><div className="table-wrap"><table className="table"><thead><tr><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{profiles.map((p)=><tr key={p.id}><td>{p.email}</td><td>{p.role}</td><td>{p.active?'Active':'Disabled'}</td></tr>)}</tbody></table></div></section>
}
