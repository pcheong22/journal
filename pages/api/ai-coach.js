// pages/api/ai-coach.js
// AI coaching — defaults to Claude (Anthropic), switchable to Qwen-Plus
//
// Vercel environment variables:
//   CLAUDE_API_KEY   get from console.anthropic.com  ← add this to activate
//   QWEN_API_KEY     get from dashscope.aliyuncs.com  ← optional alternative
//   AI_PROVIDER      "claude" or "qwen"               ← defaults to "claude"
//
// Provider selection logic:
//   1. If AI_PROVIDER=qwen and QWEN_API_KEY set  → use Qwen
//   2. If CLAUDE_API_KEY set                     → use Claude  (default)
//   3. If only QWEN_API_KEY set                  → use Qwen
//   4. Neither key set                           → stub mode

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const claudeKey  = process.env.CLAUDE_API_KEY
  const qwenKey    = process.env.QWEN_API_KEY
  const preference = (process.env.AI_PROVIDER || 'claude').toLowerCase()

  // Resolve active provider
  let provider = null
  if (preference === 'qwen' && qwenKey) provider = 'qwen'
  else if (claudeKey)                    provider = 'claude'
  else if (qwenKey)                      provider = 'qwen'

  // ── STUB MODE ──────────────────────────────────────────────────────────────
  if (!provider) {
    return res.status(200).json({
      stub:         true,
      provider:     null,
      message:      'AI coaching not activated. Add CLAUDE_API_KEY in Vercel → Settings → Environment Variables.',
      insights:     [],
      coaching_tip: 'Add your CLAUDE_API_KEY to Vercel environment variables to activate personalised AI trade coaching.',
      pattern_flags:   [],
      rule_compliance: {},
    })
  }

  // ── BUILD PROMPTS ──────────────────────────────────────────────────────────
  const { trade, stats, notes, rules = [] } = req.body
  if (!trade) return res.status(400).json({ error: 'trade data required' })

  const systemPrompt = `You are a quantitative trading coach with expertise in risk management, trading psychology, and technical analysis. You analyse individual trades and provide specific, actionable, data-driven feedback.

Respond with valid JSON only — no markdown, no code blocks, no preamble. Strictly follow this schema:
{
  "insights": ["string", "string", "string"],
  "coaching_tip": "string",
  "pattern_flags": ["string"],
  "rule_compliance": { "followed": ["string"], "broken": ["string"] }
}

Be specific and reference actual numbers from the trade. Avoid generic advice.`

  const userPrompt = `Analyse this trade:

TRADE DATA:
Symbol: ${trade.symbol} | Direction: ${trade.direction}
Entry: $${trade.entry_price} at ${trade.entry_time?.slice(0,16)?.replace('T',' ')} GMT
Exit: $${trade.exit_price} at ${trade.exit_time?.slice(0,16)?.replace('T',' ')} GMT
P&L: $${trade.pnl} | Duration: ${trade.duration_mins ? Math.round(trade.duration_mins) + ' mins' : 'unknown'}
Session: ${trade.session} | Day: ${trade.day_of_week}
R-Multiple: ${trade.r_multiple != null ? trade.r_multiple : 'not recorded'}
Stop Loss: ${trade.stop_loss != null ? '$' + trade.stop_loss : 'not set'}
Notional: ${trade.notional_usd ? '$' + Math.round(trade.notional_usd).toLocaleString() : 'unknown'}
${notes?.note_entry_reason    ? `\nEntry reason: ${notes.note_entry_reason}` : ''}
${notes?.note_management      ? `\nTrade management: ${notes.note_management}` : ''}
${notes?.note_lessons         ? `\nLessons noted: ${notes.note_lessons}` : ''}
${notes?.note_emotional_state ? `\nEmotional state: ${notes.note_emotional_state}` : ''}
${notes?.notes                ? `\nFree notes: ${notes.notes}` : ''}

ACCOUNT CONTEXT:
Win rate: ${stats?.win_rate ? (stats.win_rate * 100).toFixed(1) + '%' : 'unknown'}
Avg win: ${stats?.avg_win ? '$' + Math.round(stats.avg_win) : 'unknown'} | Avg loss: ${stats?.avg_loss ? '$' + Math.round(stats.avg_loss) : 'unknown'}
Total trades: ${stats?.total_trades || 'unknown'}
${rules.length ? `\nTRADING RULES:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}

Provide 3 specific insights, 1 prioritised coaching tip, any pattern flags (e.g. revenge_trade, no_stop_loss, early_exit, fomo), and rule compliance if rules were given.`

  // ── CLAUDE ─────────────────────────────────────────────────────────────────
  if (provider === 'claude') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-5',
          max_tokens: 1024,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: userPrompt }],
        }),
      })

      if (!response.ok) throw new Error(`Claude API ${response.status}: ${await response.text()}`)

      const data   = await response.json()
      const text   = data.content?.[0]?.text || '{}'
      const clean  = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(clean)

      return res.status(200).json({ stub: false, provider: 'claude', ...parsed })
    } catch (err) {
      console.error('Claude coach error:', err)
      return res.status(503).json({
        stub: false, provider: 'claude', error: 'AI temporarily unavailable',
        insights: [], coaching_tip: 'AI unavailable — try again shortly.',
        pattern_flags: [], rule_compliance: {},
      })
    }
  }

  // ── QWEN-PLUS ──────────────────────────────────────────────────────────────
  if (provider === 'qwen') {
    try {
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${qwenKey}`,
        },
        body: JSON.stringify({
          model:       'qwen-plus',
          max_tokens:  1024,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
        }),
      })

      if (!response.ok) throw new Error(`Qwen API ${response.status}: ${await response.text()}`)

      const data   = await response.json()
      const text   = data.choices?.[0]?.message?.content || '{}'
      const clean  = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(clean)

      return res.status(200).json({ stub: false, provider: 'qwen', ...parsed })
    } catch (err) {
      console.error('Qwen coach error:', err)
      return res.status(503).json({
        stub: false, provider: 'qwen', error: 'AI temporarily unavailable',
        insights: [], coaching_tip: 'AI unavailable — try again shortly.',
        pattern_flags: [], rule_compliance: {},
      })
    }
  }
}
