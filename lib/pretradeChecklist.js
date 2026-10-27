export const SETUP_TYPES = [
  'Pivot rejection reversal',
  'Pivot reclaim',
  'Pivot breakdown',
  'Pivot-supported continuation',
  'Pivot-to-pivot rotation',
]

export const PIVOT_TIMEFRAMES = ['Weekly','Monthly','Quarterly','Yearly']

export const CHECKLIST_SECTIONS = [
  { id:'pivots', label:'Pivot context', weight:35, items:[
    {id:'pivot_significance',label:'Anchor significance',help:'Higher-timeframe pivot is clear and relevant to this market.',max:10},
    {id:'pivot_interaction',label:'Price interaction',help:'Price has rejected, reclaimed, accepted or broken the pivot cleanly.',max:10},
    {id:'pivot_confluence',label:'Pivot confluence',help:'Another quarterly, monthly, weekly or yearly reference reinforces the area.',max:7},
    {id:'pivot_space',label:'Space to next pivot',help:'The next opposing pivot leaves enough room for the planned reward.',max:8},
  ]},
  { id:'price_action', label:'Price action', weight:25, items:[
    {id:'htf_structure',label:'Higher-timeframe structure',help:'The broader structure supports the direction or a defined reversal.',max:6},
    {id:'ltf_structure',label:'Execution-timeframe structure',help:'A break, reclaim or failure has changed the local structure.',max:7},
    {id:'entry_trigger',label:'Entry trigger',help:'The specific trigger has printed; anticipation alone does not receive full points.',max:7},
    {id:'extreme_location',label:'Location quality',help:'Entry is at an extreme or meaningful decision area rather than mid-range.',max:5},
  ]},
  { id:'auction', label:'Auction context', weight:15, items:[
    {id:'auction_location',label:'Value location',help:'Location versus value, prior range and high-volume areas supports the idea.',max:5},
    {id:'auction_acceptance',label:'Acceptance or rejection',help:'The auction response at the level matches the proposed trade.',max:5},
    {id:'auction_objective',label:'Clear auction objective',help:'There is a logical destination such as value, an extreme or the next pivot.',max:5},
  ]},
  { id:'order_flow', label:'Execution confirmation', weight:10, items:[
    {id:'participation',label:'Participation confirms',help:'Tape, volume, delta or liquidity behaviour supports the trigger.',max:5},
    {id:'opposing_failure',label:'Opposing side fails',help:'The other side shows exhaustion, failed continuation or trapped positioning.',max:5},
  ]},
  { id:'risk', label:'Risk & construction', weight:15, items:[
    {id:'invalidation',label:'Objective invalidation',help:'The stop sits beyond a structural invalidation, not at an arbitrary loss amount.',max:5},
    {id:'reward_space',label:'Reward is unobstructed',help:'The target is realistic before the next opposing pivot or auction barrier.',max:5},
    {id:'execution_risk',label:'Execution conditions',help:'Size, liquidity, volatility and event risk are acceptable.',max:5},
  ]},
]

export const CHECKLIST_ITEMS = CHECKLIST_SECTIONS.flatMap(section => section.items)
export const emptyChecks = () => Object.fromEntries(CHECKLIST_ITEMS.map(item => [item.id,0]))
export const scoreOptions = max => [{value:0,label:'No evidence'},{value:Math.floor(max/2),label:'Partial'},{value:max,label:'Confirmed'}]

const finite = value => value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null
const text = (value, limit=2000) => String(value || '').trim().slice(0,limit)
const timestamp = value => { const parsed=new Date(value); return Number.isNaN(parsed.getTime())?new Date().toISOString():parsed.toISOString() }

export function rewardRisk(plan={}) {
  const entry=finite(plan.entry_price),stop=finite(plan.stop_price),target=finite(plan.target_price)
  if(entry==null||stop==null||target==null)return null
  const risk=Math.abs(entry-stop)
  const reward=plan.direction==='Short'?entry-target:target-entry
  return risk>0&&reward>0?reward/risk:null
}

export function normalizePlan(input={}) {
  const allowed = new Map(CHECKLIST_ITEMS.map(item=>[item.id,new Set(scoreOptions(item.max).map(option=>option.value))]))
  const checks=emptyChecks()
  for(const [key,values] of allowed)checks[key]=values.has(Number(input.checks?.[key]))?Number(input.checks[key]):0
  return {
    account_id:text(input.account_id,200)||null,
    symbol:text(input.symbol,40).toUpperCase(),
    direction:input.direction==='Short'?'Short':'Long',
    setup_type:SETUP_TYPES.includes(input.setup_type)?input.setup_type:'',
    planned_at:timestamp(text(input.planned_at,40)),
    entry_price:finite(input.entry_price),stop_price:finite(input.stop_price),target_price:finite(input.target_price),
    pivot_timeframe:PIVOT_TIMEFRAMES.includes(input.pivot_timeframe)?input.pivot_timeframe:'',
    pivot_name:text(input.pivot_name,80),pivot_price:finite(input.pivot_price),
    thesis:text(input.thesis),invalidation:text(input.invalidation),notes:text(input.notes,5000),checks,
  }
}

export function evaluatePlan(input={}) {
  const plan=normalizePlan(input)
  const sectionScores=Object.fromEntries(CHECKLIST_SECTIONS.map(section=>[section.id,section.items.reduce((sum,item)=>sum+plan.checks[item.id],0)]))
  const score=Object.values(sectionScores).reduce((sum,value)=>sum+value,0)
  const rr=rewardRisk(plan)
  const gates={
    setup:Boolean(plan.setup_type),
    pivot:Boolean(plan.pivot_timeframe&&plan.pivot_name),
    trigger:plan.checks.entry_trigger===7,
    invalidation:Boolean(plan.invalidation&&plan.stop_price!=null&&plan.checks.invalidation===5),
    reward:rr!=null&&rr>=1.5,
  }
  const ready=Object.values(gates).every(Boolean)
  const floor=sectionScores.pivots>=24&&sectionScores.price_action>=15&&plan.checks.pivot_interaction>0
  let grade='C'
  if(!ready)grade='Incomplete'
  else if(score>=85&&floor)grade='A+'
  else if(score>=75&&floor)grade='A'
  else if(score>=65)grade='B'
  return {...plan,score,grade,ready,reward_risk:rr,section_scores:sectionScores,gates}
}

export function planSnapshot(evaluation) {
  const {score,grade,ready,reward_risk,section_scores,gates,...plan}=evaluation
  return {...plan,score,grade,ready,reward_risk,section_scores,gates}
}
