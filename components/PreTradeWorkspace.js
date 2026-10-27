import {useEffect,useMemo,useState} from 'react'
import {CHECKLIST_SECTIONS,PIVOT_TIMEFRAMES,SETUP_TYPES,emptyChecks,evaluatePlan,scoreOptions} from '../lib/pretradeChecklist'
import {journalFetch} from '../lib/request'

const dubaiInput=value=>new Date(new Date(value).getTime()+4*60*60*1000).toISOString().slice(0,16)
const dubaiISO=value=>value&&!/[zZ]|[+-]\d\d:\d\d$/.test(value)?value+':00+04:00':value
const blank=()=>({account_id:'',symbol:'',direction:'Long',setup_type:'',planned_at:dubaiInput(Date.now()),entry_price:'',stop_price:'',target_price:'',pivot_timeframe:'',pivot_name:'',pivot_price:'',thesis:'',invalidation:'',notes:'',checks:emptyChecks(),status:'draft'})
const inputPlan=plan=>plan?{...plan,planned_at:dubaiInput(plan.planned_at||Date.now()),checks:{...emptyChecks(),...(plan.checklist||plan.checks||{})}}:blank()
const fmtDate=value=>value?new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Dubai'}):'Unscheduled'
const gateLabels={setup:'Named setup',pivot:'Pivot anchor',trigger:'Confirmed trigger',invalidation:'Objective invalidation',reward:'At least 1.5R'}

export default function PreTradeWorkspace({accounts=[],preview=false}){
  const [plans,setPlans]=useState([]),[selected,setSelected]=useState(null),[form,setForm]=useState(blank),[loading,setLoading]=useState(!preview),[saving,setSaving]=useState(false),[message,setMessage]=useState('')
  const evaluation=useMemo(()=>evaluatePlan(form),[form])
  useEffect(()=>{if(preview){setPlans([]);setLoading(false);return}let active=true;journalFetch('/api/pretrade-plans').then(r=>r.json()).then(data=>{if(active)setPlans(data.plans||[])}).catch(error=>active&&setMessage(error.message)).finally(()=>active&&setLoading(false));return()=>{active=false}},[preview])
  const change=(key,value)=>setForm(current=>({...current,[key]:value}))
  const choose=plan=>{setSelected(plan);setForm(inputPlan(plan));setMessage('');window.scrollTo({top:0,behavior:'smooth'})}
  const startNew=()=>{setSelected(null);setForm(blank());setMessage('')}
  async function save(status){
    if(preview){setMessage('Open the live journal to save a plan.');return}
    setSaving(true);setMessage('')
    try{
      const body={...form,planned_at:dubaiISO(form.planned_at),status,id:selected?.id,revision:selected?.revision}
      const response=await journalFetch('/api/pretrade-plans',{method:selected?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      const {plan}=await response.json();setPlans(current=>[plan,...current.filter(item=>item.id!==plan.id)]);setSelected(plan);setForm(inputPlan(plan));setMessage(status==='ready'&&plan.status==='ready'?'Plan locked as ready. Original evidence preserved.':'Draft saved. Original evidence preserved.')
    }catch(error){setMessage(error.message)}finally{setSaving(false)}
  }
  async function remove(){
    if(!selected||preview||!window.confirm(`Delete the ${selected.symbol} plan? A full safety backup will be created first.`))return
    setSaving(true);setMessage('')
    try{await journalFetch('/api/pretrade-plans?id='+selected.id,{method:'DELETE'});setPlans(current=>current.filter(item=>item.id!==selected.id));startNew();setMessage('Plan deleted after creating a safety backup.')}catch(error){setMessage(error.message)}finally{setSaving(false)}
  }
  return <div className="pretrade-workspace anim">
    <div className="page-heading"><div><span className="eyebrow">Pre-trade process</span><h1>Plan the trade before the trade plans you</h1><p>Pivot-led evidence, a confirmed trigger and explicit risk. A score organises judgment; it does not replace it.</p></div><button className="btn" onClick={startNew}>New plan</button></div>
    {message&&<p className="pretrade-message" role="status">{message}</p>}
    <div className="pretrade-layout">
      <aside className="pretrade-sidebar" aria-label="Saved pre-trade plans">
        <div className="pretrade-sidebar-heading"><strong>Plans</strong><span>{plans.length}</span></div>
        {loading?<div className="pretrade-empty">Loading plans…</div>:plans.length===0?<div className="pretrade-empty">No saved plans yet. Complete the decision frame, then save the first version.</div>:plans.map(plan=><button key={plan.id} className={selected?.id===plan.id?'selected':''} onClick={()=>choose(plan)}><span><strong>{plan.symbol}</strong><small>{plan.direction} · {plan.setup_type||'Unclassified'}</small></span><span><b data-grade={plan.grade}>{plan.grade}</b><small>{plan.score}/100 · {fmtDate(plan.planned_at)}</small></span></button>)}
      </aside>
      <section className="pretrade-editor">
        <div className="pretrade-scorecard">
          <div><span>Decision grade</span><strong data-grade={evaluation.grade}>{evaluation.grade}</strong><small>{evaluation.ready?'All hard gates passed':'Not yet valid to execute'}</small></div>
          <div className="pretrade-score"><span>Evidence score</span><strong>{evaluation.score}<small>/100</small></strong><small>Pivots {evaluation.section_scores.pivots}/35</small></div>
          <div><span>Planned reward</span><strong>{evaluation.reward_risk==null?'—':evaluation.reward_risk.toFixed(2)+'R'}</strong><small>Minimum hard gate 1.50R</small></div>
        </div>
        <div className="pretrade-gates" aria-label="Hard gates">{Object.entries(evaluation.gates).map(([key,passed])=><span key={key} data-pass={passed}>{passed?'✓':'○'} {gateLabels[key]}</span>)}</div>
        <div className="pretrade-form card">
          <div className="pretrade-fields three">
            <label>Instrument<input className="inp" value={form.symbol} onChange={e=>change('symbol',e.target.value)} placeholder="e.g. CRUDE" maxLength={40}/></label>
            <label>Direction<select className="inp" value={form.direction} onChange={e=>change('direction',e.target.value)}><option>Long</option><option>Short</option></select></label>
            <label>Account<select className="inp" value={form.account_id||''} onChange={e=>change('account_id',e.target.value)}><option value="">Not assigned</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.label||account.id}</option>)}</select></label>
          </div>
          <div className="pretrade-fields two">
            <label>Setup<select className="inp" value={form.setup_type} onChange={e=>change('setup_type',e.target.value)}><option value="">Choose a setup</option>{SETUP_TYPES.map(value=><option key={value}>{value}</option>)}</select></label>
            <label>Planned time · Dubai<input type="datetime-local" className="inp" value={form.planned_at} onChange={e=>change('planned_at',e.target.value)}/></label>
          </div>
          <div className="pretrade-fields three">
            <label>Entry<input inputMode="decimal" className="inp" value={form.entry_price??''} onChange={e=>change('entry_price',e.target.value)} /></label>
            <label>Stop<input inputMode="decimal" className="inp" value={form.stop_price??''} onChange={e=>change('stop_price',e.target.value)} /></label>
            <label>First target<input inputMode="decimal" className="inp" value={form.target_price??''} onChange={e=>change('target_price',e.target.value)} /></label>
          </div>
          <div className="pretrade-pivot"><div><span>Primary decision level</span><h2>Anchor the plan to a pivot</h2></div><div className="pretrade-fields three"><label>Timeframe<select className="inp" value={form.pivot_timeframe} onChange={e=>change('pivot_timeframe',e.target.value)}><option value="">Choose timeframe</option>{PIVOT_TIMEFRAMES.map(value=><option key={value}>{value}</option>)}</select></label><label>Pivot name<input className="inp" value={form.pivot_name} onChange={e=>change('pivot_name',e.target.value)} placeholder="e.g. Monthly R1"/></label><label>Pivot price<input inputMode="decimal" className="inp" value={form.pivot_price??''} onChange={e=>change('pivot_price',e.target.value)}/></label></div></div>
          <label className="pretrade-text">Trade thesis<textarea className="inp" value={form.thesis} onChange={e=>change('thesis',e.target.value)} placeholder="What must be true for this trade to work?"/></label>
          <label className="pretrade-text">Invalidation statement<textarea className="inp" value={form.invalidation} onChange={e=>change('invalidation',e.target.value)} placeholder="What market behaviour proves the idea wrong?"/></label>
        </div>
        <div className="pretrade-checklist">
          {CHECKLIST_SECTIONS.map(section=><section key={section.id} className="card"><header><div><span>{section.label}</span><small>{section.items.reduce((sum,item)=>sum+evaluation.checks[item.id],0)} / {section.weight}</small></div><div style={{width:`${section.items.reduce((sum,item)=>sum+evaluation.checks[item.id],0)/section.weight*100}%`}}/></header>{section.items.map(item=><fieldset key={item.id}><legend><strong>{item.label}</strong><small>{item.help}</small></legend><div>{scoreOptions(item.max).map(option=><button type="button" key={option.value} aria-pressed={evaluation.checks[item.id]===option.value} onClick={()=>setForm(current=>({...current,checks:{...current.checks,[item.id]:option.value}}))}><span>{option.label}</span><b>+{option.value}</b></button>)}</div></fieldset>)}</section>)}
        </div>
        <label className="pretrade-text pretrade-notes">Context notes<textarea className="inp" value={form.notes} onChange={e=>change('notes',e.target.value)} placeholder="Event risk, liquidity, alternate scenario or anything not captured above."/></label>
        <div className="pretrade-savebar"><div><strong>{selected?'Revision '+selected.revision:'Original snapshot'}</strong><span>{selected?'The first version remains locked; saving adds a revision.':'Your first save becomes the immutable original plan.'}</span></div>{selected&&<button className="text-button danger" disabled={saving} onClick={remove}>Delete</button>}<button className="btn" disabled={saving||!form.symbol} onClick={()=>save('draft')}>Save draft</button><button className="btn btn-p" disabled={saving||!evaluation.ready||!form.symbol} onClick={()=>save('ready')}>{saving?'Saving…':'Save as ready'}</button></div>
      </section>
    </div>
  </div>
}
