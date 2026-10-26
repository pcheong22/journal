export const BACKUP_VERSION = 1
export const BACKUP_TABLES = ['accounts','trade_tags','strategies','trades','trade_tag_mappings','missed_trades','trade_images','coach_reports','user_preferences','journal_events']
export const BACKUP_LIMIT = 50 * 1024 * 1024
export const FILE_LIMIT = 20 * 1024 * 1024
export function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
export function backupCounts(snapshot) {
  return Object.fromEntries(BACKUP_TABLES.map(table => [table, snapshot.tables[table].length]))
}
export function validStoragePath(bucket, path) {
  if (typeof path !== 'string' || path.includes('..')) return false
  if (bucket === 'journal-imports') return /^[a-f0-9]{64}\/source\.gz$/.test(path)
  if (bucket === 'trade-images') return /^(trades|missed)\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_.-]{1,200}$/.test(path)
  if (bucket === 'trade-executions') return /^[a-f0-9]{64}\/\d+_\d+_\d+_[a-f0-9]{64}\.json$/.test(path)
  return false
}
export function validateBackupShape(document, project) {
  if (document?.format !== 'tradeintel-full-backup' || document.version !== BACKUP_VERSION || document.project !== project) throw new Error('Choose a full backup from this journal project and version.')
  if (!document.snapshot?.schema || !document.snapshot?.digest || !Array.isArray(document.files) || document.files.length > 2000) throw new Error('Invalid backup manifest.')
  for (const table of BACKUP_TABLES) if (!Array.isArray(document.snapshot.tables?.[table])) throw new Error('The backup is missing ' + table)
  const seen = new Set()
  for (const file of document.files) {
    if (!validStoragePath(file.bucket,file.path) || seen.has(file.bucket + '/' + file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('Invalid backup file entry.')
    seen.add(file.bucket + '/' + file.path)
  }
  if (!/^[a-f0-9]{64}$/.test(document.checksum || '')) throw new Error('Backup checksum is missing.')
  return document
}
