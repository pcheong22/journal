import { inflateRawSync } from 'node:zlib'
import Busboy from 'busboy'
import { imageSize } from 'image-size'

export function uploadError(message, status = 400) { return Object.assign(new Error(message), { status }) }

export async function readBounded(stream, limit, timeoutMs = 15000) {
  if (Number(stream.headers?.['content-length']) > limit) throw uploadError('File is too large.', 413)
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      stream.off('data', onData); stream.off('end', onEnd); stream.off('error', onError); stream.off('aborted', onAborted)
      chunks = []
      if (error) { stream.resume(); reject(error) } else resolve(value)
    }
    const onData = chunk => {
      size += chunk.length
      if (size > limit) return finish(uploadError('File is too large.', 413))
      chunks.push(chunk)
    }
    const onEnd = () => finish(null, Buffer.concat(chunks))
    const onError = () => finish(uploadError('Upload interrupted.'))
    const onAborted = () => finish(uploadError('Upload interrupted.'))
    const timer = setTimeout(() => finish(uploadError('Upload timed out.', 408)), timeoutMs)
    stream.on('data', onData); stream.on('end', onEnd); stream.on('error', onError); stream.on('aborted', onAborted)
  })
}

export async function multipart(req, maxFileBytes) {
  const buffer = await readBounded(req, maxFileBytes + 64 * 1024)
  return new Promise((resolve, reject) => {
    let parser
    try { parser = Busboy({ headers: req.headers, limits: { fileSize: maxFileBytes, files: 1, fields: 5, fieldSize: 2048, parts: 6 } }) }
    catch { return reject(uploadError('Invalid upload.')) }
    const fields = Object.create(null); let file = null; let failure = null
    parser.on('file', (name, stream, info) => {
      const chunks = []
      if (name !== 'file') failure = uploadError('Unexpected file field.')
      stream.on('error', () => { failure = uploadError('Invalid upload.') })
      stream.on('limit', () => { failure = uploadError('File is too large.', 413) })
      stream.on('data', chunk => chunks.push(chunk))
      stream.on('end', () => { file = { ...info, buffer: Buffer.concat(chunks) } })
    })
    parser.on('field', (name, value, info) => {
      if (!['accountId','timezone','entity_type','entity_id'].includes(name) || info.valueTruncated || Object.hasOwn(fields, name)) failure = uploadError('Invalid upload fields.')
      fields[name] = value
    })
    for (const event of ['partsLimit', 'filesLimit', 'fieldsLimit']) parser.on(event, () => { failure = uploadError('Upload one file at a time.') })
    parser.on('error', () => reject(uploadError('Invalid upload.')))
    parser.on('close', () => failure ? reject(failure) : !file?.buffer.length ? reject(uploadError('Choose a non-empty file.')) : resolve({ ...fields, file }))
    parser.end(buffer)
  })
}

export function inspectImage(buffer) {
  let type
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'png'
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) type = 'jpg'
  else if (buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') type = 'webp'
  else if (['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))) type = 'gif'
  else throw uploadError('Upload a PNG, JPG, WEBP or GIF screenshot.')
  if (buffer.length > 10 * 1024 * 1024) throw uploadError('Screenshots must be under 10 MB.', 413)
  let dimensions
  try { dimensions = imageSize(buffer) } catch { throw uploadError('This image is damaged or unsupported.') }
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 40000000 || dimensions.width > 20000 || dimensions.height > 20000) throw uploadError('Image dimensions are too large.')
  return { ext: type, contentType: `image/${type === 'jpg' ? 'jpeg' : type}` }
}

// Reject encrypted, ZIP64, truncated or oversized spreadsheets before decompression.
export function inspectSpreadsheet(buffer, filename) {
  if (/\.csv$/i.test(filename)) {
    if (buffer.includes(0)) throw uploadError('The CSV contains binary data.')
    return
  }
  if (/\.xls$/i.test(filename)) {
    if (buffer.subarray(0,8).toString('hex') !== 'd0cf11e0a1b11ae1') throw uploadError('Invalid XLS file.')
    return
  }
  if (!/\.xlsx$/i.test(filename)) throw uploadError('Upload a CSV, XLS or XLSX trade export.')
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break }
  }
  if (end < 0) throw uploadError('Invalid XLSX file.')
  const entries = buffer.readUInt16LE(end + 10), start = buffer.readUInt32LE(end + 16)
  if (entries > 2000 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt32LE(end + 12) === 0xffffffff || start >= end) throw uploadError('Unsupported spreadsheet archive.')
  let offset = start, expanded = 0
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw uploadError('Invalid spreadsheet archive.')
    const size = buffer.readUInt32LE(offset + 24)
    const compressed = buffer.readUInt32LE(offset + 20), method = buffer.readUInt16LE(offset + 10)
    if ((buffer.readUInt16LE(offset + 8) & 1) || size === 0xffffffff) throw uploadError('Encrypted or ZIP64 spreadsheets are unsupported.')
    // Validate local headers too: the decompressor must see the same sizes and methods.
    const local = buffer.readUInt32LE(offset + 42)
    if (local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 8) !== buffer.readUInt16LE(offset + 10)) throw uploadError('Invalid spreadsheet archive.')
    if (!(buffer.readUInt16LE(local + 6) & 8) && buffer.readUInt32LE(local + 22) !== size) throw uploadError('Inconsistent spreadsheet archive.')
    if (![0, 8].includes(method) || (buffer.readUInt16LE(local + 6) & 1)) throw uploadError('Unsupported spreadsheet compression.')
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    if (dataStart + compressed > start || compressed === 0xffffffff) throw uploadError('Invalid spreadsheet archive.')
    expanded += size
    if (expanded > 40 * 1024 * 1024) throw uploadError('Spreadsheet is too large when expanded.', 413)
    try {
      const bytes = buffer.subarray(dataStart, dataStart + compressed)
      const actual = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: Math.min(40 * 1024 * 1024 - expanded + size + 1, size + 1) })
      if (actual.length !== size) throw new Error('Size mismatch')
    } catch { throw uploadError('Spreadsheet expansion is invalid or too large.', 413) }
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
  }
  if (offset !== end) throw uploadError('Unsupported spreadsheet archive.')
}
