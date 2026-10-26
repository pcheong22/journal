import {canonicalSymbol} from './symbols'

// Display-only reference feeds. Never write these back into a trade or merge products.
export const REFERENCE_FEEDS={
 NASDAQ:['CAPITALCOM:US100','Capital.com US 100 cash CFD'],SP500:['CAPITALCOM:US500','Capital.com US 500 cash CFD'],DOWJ:['CAPITALCOM:US30','Capital.com US 30 cash CFD'],
 CRUDE:['OANDA:WTICOUSD','OANDA WTI oil CFD'], 'NAT.GAS':['OANDA:NATGASUSD','OANDA natural gas CFD'], 'COPPER/USD':['OANDA:XCUUSD','OANDA copper CFD'],
 'HK-HSI':['OANDA:HK33HKD','OANDA Hong Kong 33 CFD'],DAX:['OANDA:DE30EUR','OANDA Germany index CFD'],NIKKEI:['OANDA:JP225USD','OANDA Japan index CFD'],EUR50:['OANDA:EU50EUR','OANDA Europe 50 CFD'],
 'XAU/USD':['OANDA:XAUUSD','OANDA gold reference'], 'XAG/USD':['OANDA:XAGUSD','OANDA silver reference'],
 USO:['AMEX:USO','United States Oil Fund ETF'],IBIT:['NASDAQ:IBIT','iShares Bitcoin Trust ETF'],BITO:['AMEX:BITO','ProShares Bitcoin futures ETF'],BITI:['AMEX:BITI','ProShares inverse Bitcoin ETF'],
}
for(const coin of ['BTC','ETH','SOL','HYPE','XRP','XLM','ADA','AVAX','LTC','BNB','DOGE','LINK','ARB','OP'])REFERENCE_FEEDS[coin+'/USD']=['BINANCE:'+coin+'USDT','Binance '+coin+'/USDT spot reference']
for(const fx of ['EURUSD','USDJPY','GBPUSD','AUDUSD','USDCAD','EURJPY','CADJPY'])REFERENCE_FEEDS[fx.slice(0,3)+'/'+fx.slice(3)]=['FX:'+fx,'FX '+fx.slice(0,3)+'/'+fx.slice(3)+' reference']

export const validChartSymbol=value=>typeof value==='string'&&value.length<=80&&/^[A-Z0-9_]+:[A-Z0-9_.!/-]+$/.test(value)
export function chartReference(trade,override=''){
 const market=canonicalSymbol(trade.symbol),profile=REFERENCE_FEEDS[market],saved=validChartSymbol(trade.tv_symbol)&&!['NYMEX:CL1!','NYMEX:NG1!','HKEX:HSI','BINANCE:MATICUSDT'].includes(trade.tv_symbol)?trade.tv_symbol:null
 const symbol=validChartSymbol(override)?override:profile?.[0]||saved
 return {market,symbol,label:override?'Custom reference feed':profile?.[1]||'Saved reference feed',savedSymbol:trade.tv_symbol||trade.original_symbol||trade.symbol,known:!!profile&&!override}
}
export function chartUrl(symbol,dark=false,interval='60'){
 if(!validChartSymbol(symbol))return null
 const params=new URLSearchParams({symbol,interval,theme:dark?'dark':'light',style:'1',timezone:'Etc/UTC',withdateranges:'1',allow_symbol_change:'0',hidesidetoolbar:'0',saveimage:'1',locale:'en'})
 return 'https://www.tradingview.com/widgetembed/?'+params
}
export function fullChartUrl(symbol){return 'https://www.tradingview.com/chart/?'+new URLSearchParams({symbol:String(symbol||'')})}
export function initialChartInterval(trade){
 const minutes=Number(trade.duration_mins)
 return trade.duration_mins==null||!Number.isFinite(minutes)?'60':minutes<=120?'5':minutes<=1440?'60':'D'
}
export function chartPeriod(value){const date=new Date(value);return value&&!Number.isNaN(+date)?date.toISOString().slice(0,16).replace('T',' ')+' UTC':'Unknown'}
