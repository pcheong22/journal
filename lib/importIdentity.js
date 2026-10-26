import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
export const sourceIdentity = (prefix, parts) => `${prefix}_${bytesToHex(sha256(JSON.stringify(parts)))}`
export function occurrenceIdentity(prefix, parts, occurrences) {
  const base=sourceIdentity(prefix,parts), count=(occurrences.get(base) || 0)+1
  occurrences.set(base,count)
  return `${base}_${count}`
}
