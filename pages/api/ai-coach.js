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

  } else if (mode === 'passed_portfolio') {
    // ── PASSED TRADES PORTFOLIO ANALYSIS ──────────────────────────────────
    const { passed, actual } = req.body
    if (!passed?.length) return res.status(400).json({ error: 'passed trades required' })

    systemPrompt = `You are a quantitative trading coach specialising in decision quality analysis. Analyse a trader's passed (skipped) trades alongside their actual trades. Return ONLY valid JSON with no markdown. Use exactly this structure:
{"score":0,"score_rationale":"","verdict":"","opportunity_cost":"","discipline_rating":"","insights":[{"type":"critical","tag":"TAG","title":"","body":"","action":""}],"coaching_tip":""}

score: 0-100 rating of the trader's pass/skip decision quality (100 = perfect discipline, skipping losers and catching winners)
verdict: one sentence summary e.g. "Your passes are costing you more than they save"
opportunity_cost: one sentence on net P&L impact of passing
discipline_rating: "Overcautious" | "Well-calibrated" | "Undertaking" based on data
insights: 4-6 insights of types: critical, bias, opportunity, strength`

    // Compute passed trade stats
    const passedWins    = passed.filter(p => (p.hypothetical_pnl_usd||0) > 0)
    const passedLosses  = passed.filter(p => (p.hypothetical_pnl_usd||0) < 0)
    const totalPassedPnl = passed.reduce((s,p) => s+(p.hypothetical_pnl_usd||0), 0)
    const passedWr      = passed.length ? (passedWins.length/passed.length*100).toFixed(1) : 0
    const avgPassedPnl  = passed.length ? totalPassedPnl/passed.length : 0

    // Reason breakdown
    const reasonCounts = {}
    passed.forEach(p => { if (p.reason_missed) reasonCounts[p.reason_missed] = (reasonCounts[p.reason_missed]||0)+1 })
    const reasonStr = Object.entries(reasonCounts).map(([r,c])=>`${r}: ${c}`).join(' | ') || 'No reasons recorded'

    // Symbol breakdown
    const symMap = {}
    passed.forEach(p => {
      if (!symMap[p.symbol]) symMap[p.symbol] = { count:0, pnl:0 }
      symMap[p.symbol].count++
      symMap[p.symbol].pnl += p.hypothetical_pnl_usd||0
    })
    const symStr = Object.entries(symMap).sort((a,b)=>Math.abs(b[1].pnl)-Math.abs(a[1].pnl))
      .slice(0,6).map(([s,v])=>`${s}: ${v.count}t $${Math.round(v.pnl)}`).join(' | ')

    // Confidence breakdown
    const confMap = {}
    passed.forEach(p => { if (p.confidence_level) { confMap[p.confidence_level] = confMap[p.confidence_level]||{count:0,pnl:0}; confMap[p.confidence_level].count++; confMap[p.confidence_level].pnl+=p.hypothetical_pnl_usd||0 }})
    const confStr = Object.entries(confMap).sort((a,b)=>a[0]-b[0])
      .map(([c,v])=>`Confidence ${c}: ${v.count}t $${Math.round(v.pnl)}`).join(' | ') || 'No confidence data'

    // Notes sample (first 3 with notes)
    const notesSample = passed.filter(p=>p.notes).slice(0,3).map(p=>`[${p.symbol} ${p.direction}]: "${p.notes.slice(0,120)}"`).join('\n') || 'No notes'

    // Actual trade stats for comparison
    const actualWr  = actual?.length ? (actual.filter(t=>t.pnl>0).length/actual.length*100).toFixed(1) : null
    const actualPnl = actual?.reduce((s,t)=>s+t.pnl,0) || 0

    userPrompt = `PASSED TRADES ANALYSIS:
Total passed: ${passed.length} trades | Hypothetical P&L: $${Math.round(totalPassedPnl)} | Pass win rate: ${passedWr}% | Avg P&L if taken: $${Math.round(avgPassedPnl)}
Passes that would have won: ${passedWins.length} | Passes that would have lost: ${passedLosses.length}
Symbols: ${symStr}
Reasons for passing: ${reasonStr}
Confidence levels: ${confStr}

ACTUAL TRADES (same period): ${actual?.length||0} trades | P&L: $${Math.round(actualPnl)} | Win rate: ${actualWr||'unknown'}%

NET OPPORTUNITY COST: $${Math.round(totalPassedPnl)} (what passing cost or saved vs taking everything)

Sample notes from passed trades:
${notesSample}

Analyse whether this trader's pass decisions are adding or destroying value. Is their hesitation disciplined or fearful? Are they passing on good setups or avoiding bad ones? Reference specific numbers and patterns.`

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
