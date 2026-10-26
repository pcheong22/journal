import { requireOwner } from '../../lib/serverAuth'
export const config={api:{bodyParser:false}}
export default async function handler(req,res) {
  if (!await requireOwner(req,res)) return
  return res.status(409).json({error:'Reload the journal to review this file before importing. Direct imports have been replaced by the preview workflow.',code:'IMPORT_PREVIEW_REQUIRED'})
}
