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
  const [importRows,setImportRows] = useState<Form[]>([])
  const [importStatus,setImportStatus] = useState('')
  const [importing,setImporting] = useState(false)


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
  async function prepareExcel(file:File) {
    setImportStatus('');setImportRows([])
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), {type:'array'})
      const clean = (v:unknown) => String(v ?? '').trim().replace(/^"|"$/g,'')
      const norm = (v:unknown) => clean(v).toLowerCase().replace(/[^a-z0-9]/g,'')
      const aliases:Record<keyof Form,string[]> = {
        service:['service','platform','brand','name','account','sherbimi'],
        username:['username','user','handle','login','perdoruesi'],
        email:['email','recoveryemail','mail','e mail'],
        password:['password','pass','pwd','fjalekalimi'],
        two_factor:['2fa','twofactor','twofactorstatus','secured','admin','status'],
        notes:['notes','note','comments','info','remarks']
      }
      const output:Form[]=[]
      for(const sheetName of workbook.SheetNames){
        const raw=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName],{header:1,defval:'',raw:false})
        if(!raw.length)continue
        let header=-1;let map:Partial<Record<keyof Form,number>>={}
        for(let i=0;i<Math.min(raw.length,12);i++){
          const row=raw[i] as unknown[]
          const found:Partial<Record<keyof Form,number>>={}
          for(const k of Object.keys(aliases) as (keyof Form)[]){
            const j=row.findIndex(c=>aliases[k].some(a=>norm(c)===norm(a)))
            if(j>=0)found[k]=j
          }
          if(found.service!==undefined && (found.password!==undefined || found.username!==undefined || found.email!==undefined)){
            header=i;map=found;break
          }
        }
        // Headerless ALBI lists: Service | Username | Email | optional | Password | 2FA | Notes.
        const start=header>=0?header+1:0
        for(const rowUnknown of raw.slice(start)){
          const row=rowUnknown as unknown[]
          const get=(k:keyof Form,fallback:number)=>clean(row[header>=0?(map[k]??-1):fallback])
          const service=get('service',0)
          if(!service || /^(service|platform|info)$/i.test(service))continue
          const item:Form={service,username:get('username',1),email:get('email',2),password:get('password',4),two_factor:get('two_factor',5),notes:get('notes',6)}
          if(item.service && (item.username || item.email || item.password || item.notes))output.push(item)
        }
      }
      if(!output.length)throw new Error('No credential rows found in this Excel file.')
      setImportRows(output)
      setImportStatus(`${output.length} rows ready. Review the preview before importing.`)
    }catch(e){setImportStatus(e instanceof Error?e.message:'Excel could not be read')}
  }
  async function importExcel(){
    if(!importRows.length)return
    setImporting(true);setImportStatus('Importing securely...')
    let saved=0
    try{
      for(const row of importRows){
        await rpc('add',{p_service:row.service,p_username:row.username,p_email:row.email,p_password:row.password,p_two_factor:row.two_factor,p_notes:row.notes})
        saved++
      }
      setImportRows([]);await refresh();setImportStatus(`${saved} credentials imported into Private Vault.`)
    }catch(e){setImportStatus(`${saved} imported; stopped: ${e instanceof Error?e.message:'Request failed'}. Do not reimport the entire file or duplicates may occur.`)}
    finally{setImporting(false)}
  }
  function lock(){setUnlocked(false);setPassphrase('');setRevealed({});setEntries([])}
  const filtered=entries.filter(e=>[e.service,e.username,e.email].some(v=>(v||'').toLowerCase().includes(query.toLowerCase())))
  return <div className="panel" style={{alignContent:'start',gap:16}}>
    {message&&<div className="inline-note" role="status">{message}</div>}
    {configured===null ? <p>Checking private vault...</p> : !unlocked ? <div className="form-card" style={{maxWidth:540}}>
      <h2 style={{margin:0}}>{configured?'Unlock Private Vault':'Create Private Vault password'}</h2>
      <p className="muted">{configured?'Administrator access and a separate password are required.':'Create a strong shared password (at least 8 characters). Share it only with authorized administrators.'}</p>
      <label>Private Vault password<input className="field" type="password" autoComplete="off" value={passphrase} onChange={e=>setPassphrase(e.target.value)}/></label>
      <button className="primary-btn" disabled={busy} onClick={configured?unlock:setup}>{configured?'Unlock':'Create and unlock'}</button>
    </div> : <>
      <div className="toolbar-row"><input className="field search-field" placeholder="Search private credentials" value={query} onChange={e=>setQuery(e.target.value)}/><span className="toolbar-meta">{filtered.length} credentials</span><button className="secondary-btn" onClick={lock}>Lock</button></div>
      <div className="form-card" style={{alignContent:'start'}}>
        <h3 style={{margin:0}}>Import Excel into Private Vault</h3>
        <p className="muted">Upload an .xlsx or .xls file. Files are read in your browser and saved only through the protected Private Vault API, not in GitHub. Supports columns Service, Username, Email, Password, 2FA, Notes, or the original ALBI column order.</p>
        <input className="field" type="file" accept=".xlsx,.xls" disabled={importing||busy} onChange={e=>{const f=e.target.files?.[0];if(f)void prepareExcel(f);e.target.value=''}}/>
        {importStatus&&<p role="status">{importStatus}</p>}
        {importRows.length>0&&<>
          <p><strong>{importRows.length} rows</strong> found. First rows:</p>
          <div style={{overflowX:'auto'}}><table className="vault-table"><thead><tr><th>Service</th><th>Username</th><th>Email</th><th>Password</th></tr></thead><tbody>{importRows.slice(0,5).map((r,i)=><tr key={i}><td>{r.service}</td><td>{r.username||'—'}</td><td>{r.email||'—'}</td><td>{r.password?'••••••':'Empty'}</td></tr>)}</tbody></table></div>
          <button className="primary-btn" disabled={importing||busy} onClick={importExcel}>{importing?'Importing...':`Import ${importRows.length} into Private Vault`}</button>
          <button className="secondary-btn" disabled={importing} onClick={()=>{setImportRows([]);setImportStatus('')}}>Cancel</button>
        </>}
      </div>
      <div className="form-card"><h3 style={{margin:0}}>Add private credential</h3>
        <div className="form-grid three">
          {(['service','username','email','password','two_factor','notes'] as (keyof Form)[]).map(k=><label key={k}>{({service:'Service',username:'Username',email:'Email',password:'Password',two_factor:'2FA status',notes:'Notes'} as Record<string,string>)[k]}<input className="field" type={k==='password'?'password':'text'} autoComplete="off" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></label>)}
        </div><div><button className="primary-btn" disabled={busy||!form.service.trim()} onClick={add}>Save credential</button></div>
      </div>
      <div className="table-card" style={{alignSelf:'start',overflowX:'auto'}}><table className="vault-table"><thead><tr><th>Service</th><th>Username</th><th>Email</th><th>2FA</th><th>Password</th><th>Actions</th></tr></thead><tbody>{filtered.map(e=><tr key={e.id}><td><strong>{e.service}</strong>{e.notes&&<div className="cell-subtitle">{e.notes}</div>}</td><td>{e.username||'—'}</td><td>{e.email||'—'}</td><td>{e.two_factor||'—'}</td><td>{revealed[e.id]?<code>{revealed[e.id]}</code>:'••••••••'}</td><td><div className="button-row"><button className="table-action-btn" disabled={busy||!e.has_password} onClick={()=>revealed[e.id]?setRevealed(p=>{const x={...p};delete x[e.id];return x}):reveal(e.id)}>{revealed[e.id]?'Hide':'Reveal'}</button><button className="table-action-btn" disabled={busy} onClick={()=>remove(e.id)}>Delete</button></div></td></tr>)}{filtered.length===0&&<tr><td colSpan={6} className="empty-state">No private credentials found.</td></tr>}</tbody></table></div>
    </>}
  </div>
}
