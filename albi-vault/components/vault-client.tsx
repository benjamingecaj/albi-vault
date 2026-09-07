'use client'

import { useMemo, useState } from 'react'

type Credential = {
  id: string
  brand_name: string
  brand_id: string
  platform: string
  login_url: string | null
  username: string | null
  recovery_email: string | null
  has_2fa: boolean
  notes: string | null
  updated_at: string
}

export default function VaultClient({ credentials }: { credentials: Credential[] }) {
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return credentials
    return credentials.filter((c) => [c.brand_name, c.platform, c.username, c.recovery_email, c.notes]
      .filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [credentials, query])

  async function reveal(id: string) {
    if (revealed[id]) {
      setRevealed((v) => { const n = { ...v }; delete n[id]; return n })
      return
    }
    setLoading(id)
    try {
      const res = await fetch(`/api/reveal/${id}`, { method: 'POST', cache: 'no-store' })
      if (!res.ok) throw new Error('Could not reveal password')
      const data = await res.json()
      setRevealed((v) => ({ ...v, [id]: data.password }))
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
      <div className="toolbar">
        <input className="input search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brand, platform, username…" />
      </div>
      {filtered.length ? (
        <div className="grid">
          {filtered.map((c) => (
            <article className="card credential" key={c.id}>
              <div className="cred-head">
                <div>
                  <div className="badge">{c.brand_name}</div>
                  <h3 style={{ marginTop: 8 }}>{c.platform}</h3>
                </div>
                <span className="badge">{c.has_2fa ? '2FA ✓' : '2FA —'}</span>
              </div>
              <div className="meta">
                <div className="meta-row"><span>Username</span><span>{c.username || '—'}</span></div>
                <div className="meta-row"><span>Password</span><span className="pwbox"><code className="secret">{revealed[c.id] || '••••••••••••'}</code><button className="iconbtn" type="button" onClick={() => reveal(c.id)}>{loading === c.id ? '…' : revealed[c.id] ? 'Hide' : 'Reveal'}</button></span></div>
                <div className="meta-row"><span>Recovery</span><span>{c.recovery_email || '—'}</span></div>
                {c.notes ? <div className="meta-row"><span>Notes</span><span>{c.notes}</span></div> : null}
              </div>
              {c.login_url ? <a className="btn" href={c.login_url} target="_blank" rel="noreferrer">Open login</a> : null}
            </article>
          ))}
        </div>
      ) : <div className="card empty">No credentials match your search.</div>}
    </>
  )
}
