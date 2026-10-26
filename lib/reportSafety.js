export function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
export function validateCoachReport(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid coaching report.')
 const text=(input,max=6000)=>typeof input==='string'?input.slice(0,max):''
 const insights=Array.isArray(value.insights)?value.insights.slice(0,12).map(item=>({type:['critical','bias','opportunity','strength'].includes(item?.type)?item.type:'opportunity',tag:text(item?.tag,80),title:text(item?.title,300),body:text(item?.body),action:text(item?.action)})):[]
 return {...Object.fromEntries(['score_rationale','archetype','core_edge','core_weakness','coaching_tip','verdict'].map(key=>[key,text(value[key])])),score:Number.isFinite(value.score)?Math.max(0,Math.min(100,value.score)):null,insights,pattern_flags:Array.isArray(value.pattern_flags)?value.pattern_flags.filter(v=>typeof v==='string').slice(0,20).map(v=>text(v,300)):[],rule_compliance:value.rule_compliance&&typeof value.rule_compliance==='object'&&!Array.isArray(value.rule_compliance)?Object.fromEntries(Object.entries(value.rule_compliance).slice(0,30).map(([k,v])=>[text(k,100),typeof v==='boolean'?v:text(v,500)])):{}}
}
