// pages/api/ai-coach.js
// Two modes:
//   mode: "trade"     → analyse a single trade (called from TradeModal)
//   mode: "portfolio" → analyse full trading history (called from Coach tab)
//
// Vercel env vars:
//   QWEN_API_KEY   from dashscope.aliyuncs.com   ← set this + AI_PROVIDER=qwen
//   CLAUDE_API_KEY from console.anthropic.com     ← or this for Claude
//   AI_PROVIDER    "qwen" | "claude"              ← defaults to "claude"

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const claudeKey  = process.env.CLAUDE_API_KEY
  const qwenKey    = process.env.QWEN_API_KEY
  const preference = (process.env.AI_PROVIDER || 'claude').toLowerCase()

  // Resolve provider
  let provider = null
  if (preference === 'qwen' && qwenKey) provider = 'qwen'
  else if (claudeKey)                    provider = 'claude'
  else if (qwenKey)                      provider = 'qwen'

  // ── STUB MODE ──────────────────────────────────────────────────────────────
  if (!provider) {
    return res.status(200).json({
      stub:     true,
      provider: null,
      message:  'AI not activated. Add QWEN_API_KEY and set AI_PROVIDER=qwen in Vercel environment variables.',
      insights: [],
      coaching_tip: '',
      pattern_flags: [],
      rule_compliance: {},
    })
  }

  const { mode = 'trade', trade, stats, notes, rules = [] } = req.body

  // ── BUILD PROMPT based on mode ─────────────────────────────────────────────
  let systemPrompt, userPrompt

  if (mode === 'portfolio') {
    // ── PORTFOLIO MODE — full trading history analysis ──────────────────────
    const s = stats?.overview
    if (!s) return res.status(400).json({ error: 'stats required for portfolio mode' })

    systemPrompt = `You are a quantitative trading coach analysing a trader's complete performance history. You identify specific behavioural patterns, biases, and opportunities based on statistical evidence. You provide concrete, actionable insights backed by the numbers provided.

Respond with valid JSON only — no markdown, no code blocks, no preamble. Follow this exact schema:
{
  "score": 0-100,
  "score_rationale": "one sentence explaining the score",
  "archetype": "trader archetype label e.g. Momentum Scalper",
  "core_edge": "their main profitable strategy",
  "core_weakness": "their main losing pattern",
  "insights": [
    {
      "type": "critical|bias|opportunity|strength",
      "tag": "short label e.g. CRITICAL #1",
      "title": "insight title",
      "body": "detailed explanation with specific numbers from the data",
      "action": "specific actionable step"
    }
  ],
  "coaching_tip": "single most important thing to focus on this week"
}`

    userPrompt = `Analyse this trader's complete performance and provide coaching insights:

OVERVIEW:
- Total trades: ${s.total_trades}
- Total P&L: $${Math.round(s.total_pnl).toLocaleString()}
- Win rate: ${(s.win_rate * 100).toFixed(1)}%
- Average win: $${Math.round(s.avg_win)}
- Average loss: $${Math.round(Math.abs(s.avg_loss))}
- Risk:Reward ratio: ${s.avg_loss ? Math.abs(s.avg_win / s.avg_loss).toFixed(2) : 'N/A'}×
- Best trade: $${Math.round(s.best_trade)}
- Worst trade: $${Math.round(s.worst_trade)}
- Long P&L: $${Math.round(s.long_pnl)} (${(s.long_wr * 100).toFixed(1)}% WR, ${s.long_count} trades)
- Short P&L: $${Math.round(s.short_pnl)} (${(s.short_wr * 100).toFixed(1)}% WR, ${s.short_count} trades)
- Max win streak: ${s.max_win_streak} trades
- Max loss streak: ${s.max_loss_streak} trades

SYMBOLS (top performers by P&L):
${stats.symbols?.slice(0, 12).map(s =>
  `- ${s.symbol}: ${s.count} trades, $${Math.round(s.total_pnl)} P&L, ${(s.win_rate * 100).toFixed(1)}% WR, avg $${Math.round(s.avg_pnl)}/trade`
).join('\n') || 'No symbol data'}

SESSIONS:
${stats.sessions?.filter(s => s.session !== 'Other').map(s =>
  `- ${s.session}: ${s.count} trades, $${Math.round(s.total_pnl)} P&L, ${(s.win_rate * 100).toFixed(1)}% WR`
).join('\n') || 'No session data'}

DAY OF WEEK:
${stats.daily_dow?.map(d =>
  `- ${d.day_of_week}: ${d.count} trades, $${Math.round(d.total_pnl)} P&L, ${(d.win_rate * 100).toFixed(1)}% WR`
).join('\n') || 'No DOW data'}

DURATION BUCKETS:
${stats.duration?.map(d =>
  `- ${d.bucket}: ${d.count} trades, $${Math.round(d.total_pnl)} P&L, ${(d.win_rate * 100).toFixed(1)}% WR`
).join('\n') || 'No duration data'}

${stats.hourly?.length ? `TOP/BOTTOM HOURS (by P&L):
${[...stats.hourly].sort((a,b) => b.total_pnl - a.total_pnl).slice(0,3).map(h =>
  `- ${String(h.hour).padStart(2,'0')}:00 GMT: $${Math.round(h.total_pnl)} P&L, ${(h.win_rate*100).toFixed(0)}% WR, ${h.count} trades`
).join('\n')}
${[...stats.hourly].sort((a,b) => a.total_pnl - b.total_pnl).slice(0,3).map(h =>
  `- ${String(h.hour).padStart(2,'0')}:00 GMT: $${Math.round(h.total_pnl)} P&L, ${(h.win_rate*100).toFixed(0)}% WR, ${h.count} trades`
).join('\n')}` : ''}

Provide 6-8 insights covering: worst performing instruments, best edge, behavioural biases (revenge trading, overtrading specific sessions/days), timing patterns, risk management issues, and specific opportunities. Reference exact numbers. Score the trader 0-100 on consistency.`

  } else {
    // ── TRADE MODE — single trade analysis ─────────────────────────────────
    if (!trade) return res.status(400).json({ error: 'trade required for trade mode' })

    systemPrompt = `You are a quantitative trading coach analysing individual trades. Provide specific, data-driven feedback on execution, psychology, and risk management. Respond with valid JSON only — no markdown, no preamble.
Schema: {"insights":[],"coaching_tip":"","pattern_flags":[],"rule_compliance":{"followed":[],"broken":[]}}`

    userPrompt = `Analyse this trade:
Symbol: ${trade.symbol} | Direction: ${trade.direction} | P&L: $${trade.pnl}
Duration: ${trade.duration_mins ? Math.round(trade.duration_mins) + ' mins' : 'unknown'} | Session: ${trade.session} | Day: ${trade.day_of_week}
Entry: $${trade.entry_price} | Exit: $${trade.exit_price}
R-Multiple: ${trade.r_multiple != null ? trade.r_multiple : 'not set'} | Stop: ${trade.stop_loss || 'not set'}
${notes?.note_entry_reason    ? `Entry reason: ${notes.note_entry_reason}` : ''}
${notes?.note_management      ? `Management: ${notes.note_management}` : ''}
${notes?.note_lessons         ? `Lessons: ${notes.note_lessons}` : ''}
${notes?.note_emotional_state ? `Emotion: ${notes.note_emotional_state}` : ''}
${notes?.notes                ? `Notes: ${notes.notes}` : ''}
Account WR: ${stats?.win_rate ? (stats.win_rate*100).toFixed(1)+'%' : 'unknown'}
${rules.length ? `Rules: ${rules.join('; ')}` : ''}
Provide 3 insights, 1 tip, pattern flags, rule compliance.`
  }

  // ── CALL AI PROVIDER ───────────────────────────────────────────────────────
  const callClaude = async () => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':claudeKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: mode === 'portfolio' ? 3000 : 1024,
        system:     systemPrompt,
        messages:   [{ role:'user', content:userPrompt }],
      }),
    })
    if (!response.ok) throw new Error(`Claude ${response.status}: ${await response.text()}`)
    const data = await response.json()
    return data.content?.[0]?.text || '{}'
  }

  const callQwen = async () => {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${qwenKey}` },
      body: JSON.stringify({
        model:       'qwen-plus',
        max_tokens:  mode === 'portfolio' ? 3000 : 1024,
        temperature: 0.3,
        messages: [
          { role:'system', content:systemPrompt },
          { role:'user',   content:userPrompt   },
        ],
      }),
    })
    if (!response.ok) throw new Error(`Qwen ${response.status}: ${await response.text()}`)
    const data = await response.json()
    return data.choices?.[0]?.message?.content || '{}'
  }

  try {
    const raw    = provider === 'claude' ? await callClaude() : await callQwen()
    const clean  = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean)
    return res.status(200).json({ stub:false, provider, mode, ...parsed })
  } catch (err) {
    console.error('AI coach error:', err)
    return res.status(503).json({
      stub: false, provider, mode,
      error: 'AI temporarily unavailable — try again shortly.',
      insights: [], coaching_tip: '', pattern_flags: [], rule_compliance: {},
    })
  }
}
