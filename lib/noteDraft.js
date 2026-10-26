const fields=['notes','note_entry_reason','note_management','note_lessons','note_emotional_state','stop_loss']
export const draftKey=trade=>`ti_note_draft:${trade.account_id}:${trade.id}`
export function readNoteDraft(storage,trade){try{const draft=JSON.parse(storage.getItem(draftKey(trade)));if(draft?.version!==1||draft.id!==trade.id||draft.account!==trade.account_id||!draft.values||fields.some(key=>typeof draft.values[key]!=='string'||draft.values[key].length>20000))return null;return draft}catch{return null}}
export function writeNoteDraft(storage,trade,values,revision){const draft={version:1,id:trade.id,account:trade.account_id,revision,savedAt:new Date().toISOString(),values:Object.fromEntries(fields.map(key=>[key,String(values[key]??'').slice(0,20000)]))};storage.setItem(draftKey(trade),JSON.stringify(draft));return draft}
export const NOTE_TEMPLATES={
 'Execution review':{note_entry_reason:'Setup and trigger: ',note_management:'Planned risk and execution: ',note_lessons:'One change for next time: ',note_emotional_state:'Before / during / after: '},
 'Weekly lesson':{note_lessons:'What repeated this week?\nEvidence from this trade:\nOne rule to test next week: '}
}
