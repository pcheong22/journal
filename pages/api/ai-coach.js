// pages/api/ai-coach.js
// Two modes: "trade" (single trade) | "portfolio" (full history)
// Providers: Qwen-Plus (QWEN_API_KEY) | Claude (CLAUDE_API_KEY)

// Tell Vercel this function needs up to 60 seconds (Fluid Compute required)
export const config = {
  maxDuration: 60,
}

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
      message:  'AI not activated. Add QWEN_API_KEY and set AI_PROVIDER=qwen in Vercel environment variables, then redeploy.',
      insights: [],
      coaching_tip: '',
      pattern_flags: [],
      rule_compliance: {},
    })
  }

  const { mode = 'trade', trade, stats, notes, rules = [] } = req.body

  // ── BUILD PROMPTS ──────────────────────────────────────────────────────────
  let systemPrompt, userPrompt

  if (mode === 'portfolio') {
    const s = stats?.overview
    if (!s) return res.status(400).json({ error: 'stats.overview required for portfolio mode' })

    systemPrompt = `You are a quantitative trading coach. Analyse a trader's complete performance statistics and return a JSON coaching report. Return ONLY valid JSON with no markdown, no code blocks, no explanation outside the JSON. Use exactly this structure:
{"score":0,"score_rationale":"","archetype":"","core_edge":"","core_weakness":"","coaching_tip":"","insights":[{"type":"critical","tag":"CRITICAL #1","title":"","body":"","action":""}]}`

    // Keep the prompt concise to avoid token issues
    const topSymbols = stats.symbols?.slice(0, 10).map(s =>
      `${s.symbol}: ${s.count}t, $${Math.round(s.total_pnl)}, ${(s.win_rate*100).toFixed(0)}% WR`
    ).join(' | ') || ''

    const sessions = stats.sessions?.filter(s => s.session !== 'Other').map(s =>
      `${s.session}: ${s.count}t, $${Math.round(s.total_pnl)}, ${(s.win_rate*100).toFixed(0)}% WR`
    ).join(' | ') || ''

    const dow = stats.daily_dow?.map(d =>
      `${d.day_of_week.slice(0,3)}: ${d.count}t, $${Math.round(d.total_pnl)}, ${(d.win_rate*100).toFixed(0)}% WR`
    ).join(' | ') || ''

    const duration = stats.duration?.map(d =>
      `${d.bucket}: ${d.count}t, $${Math.round(d.total_pnl)}, ${(d.win_rate*100).toFixed(0)}% WR`
    ).join(' | ') || ''

    const topHours = stats.hourly ? [...stats.hourly]
      .sort((a,b) => b.total_pnl - a.total_pnl)
      .slice(0, 5)
      .map(h => `${String(h.hour).padStart(2,'0')}:00 $${Math.round(h.total_pnl)} ${(h.win_rate*100).toFixed(0)}%WR`)
      .join(', ') : ''

    userPrompt = `Trader stats:
OVERVIEW: ${s.total_trades} trades | P&L $${Math.round(s.total_pnl)} | WR ${(s.win_rate*100).toFixed(1)}% | Avg win $${Math.round(s.avg_win)} | Avg loss $${Math.round(Math.abs(s.avg_loss))} | R:R ${s.avg_loss ? Math.abs(s.avg_win/s.avg_loss).toFixed(2) : 'N/A'} | Best $${Math.round(s.best_trade)} | Worst $${Math.round(s.worst_trade)} | Long P&L $${Math.round(s.long_pnl)} (${(s.long_wr*100).toFixed(0)}%WR ${s.long_count}t) | Short P&L $${Math.round(s.short_pnl)} (${(s.short_wr*100).toFixed(0)}%WR ${s.short_count}t) | Max win streak ${s.max_win_streak} | Max loss streak ${s.max_loss_streak}
SYMBOLS: ${topSymbols}
SESSIONS: ${sessions}
DAY OF WEEK: ${dow}
DURATION: ${duration}
TOP HOURS (GMT): ${topHours}

Return a JSON coaching report. Score 0-100. Provide 6-8 insights mixing critical issues, biases, opportunities and strengths. Reference specific numbers. insight.type must be one of: critical, bias, opportunity, strength.`

  } else {
    // Single trade mode
    if (!trade) return res.status(400).json({ error: 'trade required' })

    systemPrompt = `You are a quantitative trading coach. Analyse a single trade and return JSON only, no markdown. Structure: {"insights":["string","string","string"],"coaching_tip":"string","pattern_flags":["string"],"rule_compliance":{"followed":[],"broken":[]}}`

    userPrompt = `Trade: ${trade.symbol} ${trade.direction} P&L $${trade.pnl} | Duration ${trade.duration_mins ? Math.round(trade.duration_mins)+'min' : 'unknown'} | Session ${trade.session} | Entry $${trade.entry_price} Exit $${trade.exit_price} | R ${trade.r_multiple ?? 'not set'} | Stop ${trade.stop_loss || 'not set'}
${notes?.note_entry_reason ? 'Entry: '+notes.note_entry_reason : ''}
${notes?.note_management   ? 'Mgmt: '+notes.note_management   : ''}
${notes?.note_lessons      ? 'Lessons: '+notes.note_lessons    : ''}
${notes?.notes             ? 'Notes: '+notes.notes             : ''}
Account WR: ${stats?.win_rate ? (stats.win_rate*100).toFixed(1)+'%' : 'unknown'}
${rules.length ? 'Rules: '+rules.join('; ') : ''}
Give 3 specific insights, 1 coaching tip, any pattern flags (e.g. no_stop_loss, revenge_trade, early_exit), rule compliance if rules given.`
  }

  // ── CALL QWEN ─────────────────────────────────────────────────────────────
  const callQwen = async () => {
    const response = await fetch(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${qwenKey}`,
        },
        body: JSON.stringify({
          model:       'qwen-plus',
          max_tokens:  2000,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
        }),
      }
    )

    const responseText = await response.text()

    if (!response.ok) {
      throw new Error(`Qwen API error ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      throw new Error(`Qwen response not valid JSON: ${responseText.slice(0, 200)}`)
    }

    return data.choices?.[0]?.message?.content || null
  }

  // ── CALL CLAUDE ───────────────────────────────────────────────────────────
  const callClaude = async () => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 2000,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    })

    const responseText = await response.text()

    if (!response.ok) {
      throw new Error(`Claude API error ${response.status}: ${responseText}`)
    }

    const data = JSON.parse(responseText)
    return data.content?.[0]?.text || null
  }

  // ── EXECUTE ───────────────────────────────────────────────────────────────
  try {
    const raw = provider === 'claude' ? await callClaude() : await callQwen()

    if (!raw) {
      return res.status(503).json({
        stub: false, provider, mode,
        error: 'AI returned an empty response. Try again.',
        insights: [], coaching_tip: '', pattern_flags: [], rule_compliance: {},
      })
    }

    // Robust JSON extraction — handles markdown code blocks and extra text
    let parsed
    try {
      // First try direct parse
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(clean)
    } catch (e) {
      // Try to extract JSON object from response
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          parsed = JSON.parse(match[0])
        } catch (e2) {
          throw new Error(`Could not parse AI response as JSON. Raw: ${raw.slice(0, 300)}`)
        }
      } else {
        throw new Error(`No JSON found in AI response. Raw: ${raw.slice(0, 300)}`)
      }
    }

    return res.status(200).json({ stub: false, provider, mode, ...parsed })

  } catch (err) {
    console.error('AI coach error:', err.message)

    // Return the actual error message to help diagnose
    return res.status(503).json({
      stub:     false,
      provider,
      mode,
      error:    err.message || 'AI temporarily unavailable',
      insights: [],
      coaching_tip:    '',
      pattern_flags:   [],
      rule_compliance: {},
    })
  }
}
