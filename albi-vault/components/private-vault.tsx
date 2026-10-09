'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Entry = { id:string; service:string; username:string|null; email:string|null; two_factor:string|null; notes:string|null; has_password:boolean }
type Form = { service:string; username:string; email:string; password:string; two_factor:string; notes:string }
const empty:Form = { service:'',username:'',email:'',password:'',two_factor:'',notes:'' }

export default function PrivateVault() {
  const [configured,setConfigured] = useState<boolean|null>(null)
  const [passphrase,setPassphrase] = useState('')
  const [unlocked,setUnlocked] = useState(false)
  const [entries,setEntries] = useState<Entry[]>([])
  const [form,setForm] = useState<Form>(empty)
  const [query,setQuery] = useState('')
  const [revealed,setRevealed] = useState<Record<string,string>>({})
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)

  async function rpc(action:string, extra:Record<string,unknown> = {}):Promise<any> {
    const supabase = createClient()
    const {data,error} = await supabase.rpc('private_vault_rpc', {p_action:action, ...(action === 'status' ? {} : {p_passphrase:passphrase}),...extra})
    if(error) throw new Error(error.message)
    return data
  }
  useEffect(()=>{ rpc('status').then(x=>setConfigured(Boolean(x.configured))).catch(e=>setMessage(e.message)) },[])
  async function run(action:()=>Promise<void>) { setBusy(true);setMessage('');try{await action()}catch(e){setMessage(e instanceof Error?e.message:'Request failed')}finally{setBusy(false)} }
  async function refresh(){const result=await rpc('list');setEntries(result.entries||[])}
  async function unlock(){await run(async()=>{if(!passphrase)throw new Error('Enter the private password');await refresh();setUnlocked(true)})}
  async function setup(){await run(async()=>{if(passphrase.length<8)throw new Error('Use at least 8 characters');await rpc('setup');setConfigured(true);await refresh();setUnlocked(true)})}
  async function add(){await run(async()=>{await rpc('add',{
    p_service:form.service,p_username:form.username,p_email:form.email,p_password:form.password,
    p_two_factor:form.two_factor,p_notes:form.notes
  });setForm(empty);await refresh();setMessage('Credential saved securely')})}
  async function reveal(id:string){await run(async()=>{const result=await rpc('reveal',{p_id:id});setRevealed(prev=>({...prev,[id]:result.password||'(empty)'}))})}
  async function remove(id:string){if(!window.confirm('Delete this private credential permanently?'))return;await run(async()=>{await rpc('delete',{p_id:id});await refresh()})}
  function lock(){setUnlocked(false);setPassphrase('');setRevealed({});setEntries([])}
  const filtered=entries.filter(e=>[e.service,e.username,e.email].some(v=>(v||'').toLowerCase().includes(query.toLowerCase())))
  return <div className="panel" style={{alignContent:'start',gap:16}}>
    {message&&<div className="inline-note" role="status">{message}</div>}
    {configured===null ? <p>Checking private vault...</p> : !unlocked ? <div className="form-card" style={{maxWidth:540}}>
      <h2 style={{margin:0}}>{configured?'Unlock Private Vault':'Create Private Vault password'}</h2>
      <p className="muted">{configured?'Administrator access and a separate password are required.':'Create a strong shared password (at least 16 characters). Share it only with authorized administrators.'}</p>
      <label>Private Vault password<input className="field" type="password" autoComplete="off" value={passphrase} onChange={e=>setPassphrase(e.target.value)}/></label>
      <button className="primary-btn" disabled={busy} onClick={configured?unlock:setup}>{configured?'Unlock':'Create and unlock'}</button>
    </div> : <>
      <div className="toolbar-row"><input className="field search-field" placeholder="Search private credentials" value={query} onChange={e=>setQuery(e.target.value)}/><span className="toolbar-meta">{filtered.length} credentials</span><button className="secondary-btn" onClick={lock}>Lock</button></div>
      <div className="form-card"><h3 style={{margin:0}}>Add private credential</h3>
        <div className="form-grid three">
          {(['service','username','email','password','two_factor','notes'] as (keyof Form)[]).map(k=><label key={k}>{({service:'Service',username:'Username',email:'Email',password:'Password',two_factor:'2FA status',notes:'Notes'} as Record<string,string>)[k]}<input className="field" type={k==='password'?'password':'text'} autoComplete="off" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></label>)}
        </div><div><button className="primary-btn" disabled={busy||!form.service.trim()} onClick={add}>Save credential</button></div>
      </div>
      <div className="table-card" style={{alignSelf:'start',overflowX:'auto'}}><table className="vault-table"><thead><tr><th>Service</th><th>Username</th><th>Email</th><th>2FA</th><th>Password</th><th>Actions</th></tr></thead><tbody>{filtered.map(e=><tr key={e.id}><td><strong>{e.service}</strong>{e.notes&&<div className="cell-subtitle">{e.notes}</div>}</td><td>{e.username||'—'}</td><td>{e.email||'—'}</td><td>{e.two_factor||'—'}</td><td>{revealed[e.id]?<code>{revealed[e.id]}</code>:'••••••••'}</td><td><div className="button-row"><button className="table-action-btn" disabled={busy||!e.has_password} onClick={()=>revealed[e.id]?setRevealed(p=>{const x={...p};delete x[e.id];return x}):reveal(e.id)}>{revealed[e.id]?'Hide':'Reveal'}</button><button className="table-action-btn" disabled={busy} onClick={()=>remove(e.id)}>Delete</button></div></td></tr>)}{filtered.length===0&&<tr><td colSpan={6} className="empty-state">No private credentials found.</td></tr>}</tbody></table></div>
    </>}
  </div>
}
