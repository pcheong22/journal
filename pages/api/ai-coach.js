export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'})
  
  const API_KEY = process.env.QWEN_API_KEY
  if(!API_KEY) return res.status(503).json({error:'AI service not configured. Add QWEN_API_KEY to env vars.'})

  try {
    const { trades, userRules } = req.body
    const prompt = `You are a quantitative trading coach. Analyze these ${trades.length} trades and rules. Return strict JSON: {insights:[],coaching_tip:"",pattern_flags:[]}`
    
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:'POST',
      headers:{'Authorization':`Bearer ${API_KEY}`,'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'qwen-plus',
        messages:[{role:'user',content:prompt}],
        response_format:{type:'json_object'}
      })
    })
    const data = await response.json()
    res.status(200).json(JSON.parse(data.choices[0].message.content))
  } catch(err) {
    res.status(500).json({error:'AI analysis failed',details:err.message})
  }
}