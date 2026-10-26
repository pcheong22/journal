// Synthetic records for the public visual preview. No account or trade data is copied.
export function designSample(){
 const accounts=[{id:'sample-primary',label:'Primary account',broker:'Hyperliquid',currency:'USDC',color:'#698c9b'},{id:'sample-active',label:'Active trading',broker:'PrimeXBT',currency:'USD',color:'#988b76'}]
 const tags=[{id:1,name:'Reviewed',category:'Journal',color:'#568b75'},{id:2,name:'Followed plan',category:'Journal',color:'#698c9b'},{id:3,name:'Breakout',category:'Setup',color:'#698c9b'}]
 const symbols=['BTC/USD','CRUDE','NASDAQ','XAU/USD','ETH/USD','SP500','XAG/USD','EUR/USD']
 const prices=[67000,74,21000,2650,2500,5700,31,1.08],outcomes=[1250,850,-1400,620,1780,-960,340,1150,720,-1850,1430,2100]
 const trades=Array.from({length:96},(_,i)=>{const symbol=symbols[i%8],entry=prices[i%8],pnl=outcomes[i%12]*(1+(i%5)/10),direction=i%3?'Long':'Short',duration=45+(i%11)*67,date=new Date(Date.UTC(2026,6,1+i,8+i%10)),exit=new Date(+date+duration*60000),price=entry*(1+(direction==='Long'?1:-1)*(pnl>=0?.012:-.008));return {id:i+1,position_id:'sample-'+i,account_id:accounts[i%2].id,broker:accounts[i%2].broker,symbol,direction,size:5+i,entry_time:date.toISOString(),exit_time:exit.toISOString(),entry_price:entry,exit_price:price,pnl,fee:12,currency:'USDC',duration_mins:duration,notional_usd:Math.abs(pnl/.012),notional_method:'price_x_size',session:['Asia','London','New York'][i%3],day_of_week:date.toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'}),journal_revision:0,tag_ids:i%4?[1,2]:[],notes:i%4?'Stayed within the planned risk. Review the exit against the original thesis.':'',execution_count:6,tv_symbol:symbol==='CRUDE'?'NYMEX:CL1!':symbol}})
 return {accounts,tags,trades}
}
