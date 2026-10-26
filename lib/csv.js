import { uploadError } from './uploadSafety'
export function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const pushField = () => { if (field.length > 65536) throw uploadError('A CSV field exceeds 64 KB.', 413); if (row.length >= 300) throw uploadError('Trade export exceeds 300 columns.', 413); row.push(field.trim()); field = '' }
  const pushRow = () => { if (rows.length >= 100001) throw uploadError('Trade export exceeds 100,000 data rows.', 413); rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    if (field.length > 65536) throw uploadError('A CSV field exceeds 64 KB.', 413)
    const ch = text[i], next = text[i+1]
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++ }
      else if (ch === '"')            { inQuotes = false }
      else                            { field += ch }
    } else {
      if      (ch === '"')  { inQuotes = true }
      else if (ch === ',')  { pushField() }
      else if (ch === '\r' && next === '\n') { pushField(); pushRow(); i++ }
      else if (ch === '\n') { pushField(); pushRow() }
      else                  { field += ch }
    }
  }
  if (inQuotes) throw uploadError('The CSV has an unterminated quoted field.')
  if (field || row.length) { pushField(); pushRow() }
  return rows.filter(r => r.some(c => c !== ''))
}

