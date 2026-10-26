import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
const require = createRequire(import.meta.url)
const policyText = readFileSync(new URL('../lib/accessPolicy.js', import.meta.url), 'utf8')
const policy = await import('data:text/javascript;base64,' + Buffer.from(policyText).toString('base64'))
let uploadText = readFileSync(new URL('../lib/uploadSafety.js', import.meta.url), 'utf8')
uploadText = uploadText.replace("'busboy'", JSON.stringify(new URL('../node_modules/busboy/lib/index.js', import.meta.url).href)).replace("'image-size'", JSON.stringify(import.meta.resolve('image-size')))
const safety = await import('data:text/javascript;base64,' + Buffer.from(uploadText).toString('base64'))

test('only the configured, verified owner can access data', () => {
  const user = { email: 'OWNER@example.com', email_confirmed_at: '2026-01-01' }
  assert.equal(policy.ownerAllowed(user, 'owner@example.com'), true)
  for (const candidate of [null, {}, { ...user, email: 'other@example.com' }, { ...user, email_confirmed_at: null }]) assert.equal(policy.ownerAllowed(candidate, 'owner@example.com'), false)
  assert.equal(policy.ownerAllowed(user, ''), false)
})
test('mutations require both the exact origin and a non-form header', () => {
  const headers = { origin: 'https://journal.example', 'x-journal-request': '1' }
  assert.equal(policy.trustedMutation({ headers }, 'https://journal.example/'), true)
  for (const change of [{ origin: 'https://attacker.example' }, { origin: 'null' }, { origin: undefined }, { 'x-journal-request': undefined }]) assert.equal(policy.trustedMutation({ headers: { ...headers, ...change } }, 'https://journal.example'), false)
  assert.equal(policy.trustedMutation({ headers }, ''), false)
})
test('remote screenshot imports accept only exact HTTPS TradingView snapshot paths', () => {
  assert.equal(policy.tradingViewImage('https://www.tradingview.com/x/Ab12/'), 'https://s3.tradingview.com/snapshots/a/Ab12.png')
  assert.equal(policy.tradingViewImage('https://s3.tradingview.com/snapshots/a/Ab12.png'), 'https://s3.tradingview.com/snapshots/a/Ab12.png')
  for (const url of ['http://www.tradingview.com/x/abc', 'https://localhost/x/abc', 'https://127.0.0.1/x/abc', 'https://evil.com/tradingview.com/x/abc', 'https://tradingview.com.evil.com/x/abc', 'https://user@tradingview.com/x/abc', 'https://s3.tradingview.com/snapshots/a/a.png?url=http://localhost', 'file:///etc/passwd', 'https://s3.tradingview.com/anything']) assert.throws(() => policy.tradingViewImage(url))
})
test('image storage paths come from saved records and reject foreign URLs and traversal', () => {
  const base = 'https://project.supabase.co'
  assert.equal(policy.imageLocation({ url: `${base}/storage/v1/object/public/trade-images/missed/temp_123_abc/x.png` }, base), 'missed/temp_123_abc/x.png')
  for (const url of ['https://evil.com/storage/v1/object/public/trade-images/trades/1/a.png', `${base}/storage/v1/object/public/trade-executions/a.json`, `${base}/storage/v1/object/public/trade-images/trades/1/%2e%2e%2fa.png`]) assert.throws(() => policy.imageLocation({ url }, base))
})
test('stream limits reject declared and undeclared oversized bodies and truncated requests', async () => {
  await assert.rejects(safety.readBounded(Object.assign(Readable.from([Buffer.alloc(11)]), { headers: { 'content-length': '11' } }), 10), /too large/)
  await assert.rejects(safety.readBounded(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), 10), /too large/)
  assert.equal((await safety.readBounded(Readable.from([Buffer.from('abc')]), 10)).toString(), 'abc')
  const stalled = new Readable({ read() {} })
  await assert.rejects(safety.readBounded(stalled, 10, 10), /timed out/)
  stalled.destroy()
})
test('multipart accepts one bounded file and rejects duplicate files or truncated fields', async () => {
  const request = parts => Object.assign(Readable.from([Buffer.from(parts)]), { headers: { 'content-type': 'multipart/form-data; boundary=test' } })
  const file = '\r\nContent-Disposition: form-data; name="file"; filename="trades.csv"\r\nContent-Type: text/csv\r\n\r\na,b\r\n'
  const data = await safety.multipart(request('--test' + file + '--test\r\nContent-Disposition: form-data; name="accountId"\r\n\r\nABC\r\n--test--\r\n'), 20)
  assert.equal(data.file.buffer.toString(), 'a,b'); assert.equal(data.accountId, 'ABC')
  await assert.rejects(safety.multipart(request('--test' + file + '--test' + file + '--test--\r\n'), 20), /one file/)
  await assert.rejects(safety.multipart(request('--test' + file + '--test--\r\n'), 2), /too large/)
})
test('image validation rejects disguised HTML, SVG and excessive pixel dimensions', () => {
  for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<html><script>alert(1)</script></html>', 'not an image']) assert.throws(() => safety.inspectImage(Buffer.from(text)))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cVh8AAAAASUVORK5CYII=', 'base64')
  assert.equal(safety.inspectImage(png).contentType, 'image/png')
  const huge = Buffer.from(png); huge.writeUInt32BE(30000, 16)
  assert.throws(() => safety.inspectImage(huge), /dimensions/)
})
test('spreadsheets must match supported formats and bounded expansion', () => {
  assert.doesNotThrow(() => safety.inspectSpreadsheet(Buffer.from('a,b\n1,2'), 'export.csv'))
  for (const name of ['evil.html', 'export.xls', 'export.xlsx']) assert.throws(() => safety.inspectSpreadsheet(Buffer.from('<html>'), name))
  const XLSX = require('xlsx'); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['a','b'],[1,2]]), 'Trades')
  const zip = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  assert.doesNotThrow(() => safety.inspectSpreadsheet(zip, 'export.xlsx'))
  const entry = zip.indexOf(Buffer.from('504b0102', 'hex')); zip.writeUInt32LE(100000000, entry + 24)
  assert.throws(() => safety.inspectSpreadsheet(zip, 'export.xlsx'))
})

const vm = await import('node:vm')
const { transformSync } = require('next/dist/build/swc')
function compiledModule(relative, mockRequire, env = {}) {
  const filename = new URL(relative, import.meta.url).pathname
  const source = readFileSync(filename, 'utf8')
  const compiled = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2020' }, module: { type: 'commonjs' } }).code
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: mockRequire, process: { env }, Buffer, console, URL, setTimeout, clearTimeout })
  return exports
}
const response = () => ({ headers: {}, code: 200, setHeader(key, value) { this.headers[key] = value }, getHeader(key) { return this.headers[key] }, status(code) { this.code = code; return this }, json(body) { this.body = body; return this }, end() { return this } })

test('every data endpoint denies access before any database, storage or AI operation', async () => {
  const { readdirSync } = await import('node:fs')
  for (const name of readdirSync(new URL('../pages/api', import.meta.url)).filter(name => name.endsWith('.js'))) {
    let checks = 0
    const handler = compiledModule('../pages/api/' + name, path => {
      if (path.endsWith('/serverAuth')) return { requireOwner: async (req, res) => { checks++; res.status(401).json({ error: 'Sign in' }); return false } }
      if (path === '@supabase/supabase-js') return { createClient: () => new Proxy({}, { get() { throw new Error('Database used before authorization: ' + name) } }) }
      return {}
    }).default
    for (const method of ['GET','POST','PATCH','DELETE']) {
      const res = response(); await handler({ method, query: {}, headers: {}, body: {} }, res)
      assert.equal(res.code, 401, name + ':' + method)
    }
    assert.equal(checks, 4, name)
  }
})

test('server guard verifies the remote user, fails closed and writes only private cookies', async () => {
  let user = { email: 'owner@example.com', email_confirmed_at: '2026-01-01' }, authError = null, options, calls = 0
  const env = { JOURNAL_OWNER_EMAIL: 'owner@example.com', JOURNAL_APP_URL: 'https://journal.example', NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public' }
  const auth = compiledModule('../lib/serverAuth.js', path => {
    if (path === './accessPolicy') return policy
    if (path === 'cookie') return require('cookie')
    if (path === '@supabase/ssr') return { createServerClient: (url, key, opts) => { options = opts; return { auth: { getUser: async () => { calls++; return { data: { user }, error: authError } } } } } }
    throw new Error(path)
  }, env)
  const req = { method: 'GET', headers: {}, cookies: {} }
  let res = response()
  assert.ok(await auth.requireOwner(req, res))
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0')
  options.cookies.setAll([{ name: 'session', value: 'secret', options: { maxAge: 3600, httpOnly: false, secure: false } }])
  assert.match(res.headers['Set-Cookie'][0], /HttpOnly/); assert.match(res.headers['Set-Cookie'][0], /Secure/); assert.match(res.headers['Set-Cookie'][0], /SameSite=Lax/)
  user = { ...user, email: 'other@example.com' }; res = response()
  assert.equal(await auth.requireOwner(req, res), false); assert.equal(res.code, 401)
  authError = new Error('revoked'); res = response()
  assert.equal(await auth.requireOwner(req, res), false); assert.equal(res.code, 401)
  const count = calls; res = response()
  assert.equal(await auth.requireOwner({ ...req, method: 'POST' }, res), false); assert.equal(res.code, 403); assert.equal(calls, count)
  env.JOURNAL_OWNER_EMAIL = ''; res = response()
  assert.equal(await auth.requireOwner(req, res), false); assert.equal(res.code, 503)
})

test('account deletion requires the exact typed target and reports database failures', async () => {
  let calls = [], dbError = null
  const handler = compiledModule('../pages/api/clear.js', path => {
    if (path.endsWith('/serverAuth')) return { requireOwner: async () => ({ email: 'owner@example.com' }) }
    if (path.endsWith('/backupStore')) return { createFullBackup: async () => ({record:{id:'safety'}}) }
    if (path === '@supabase/supabase-js') return { createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: dbError } } }) }
    throw new Error(path)
  }).default
  for (const [account, confirmation] of [['ABC', 'DELETE ALL'], ['ABC', 'DELETE XYZ'], [undefined, undefined]]) {
    const res = response(); await handler({ method:'DELETE', query:{ account }, headers:{ 'x-journal-delete': confirmation } }, res)
    assert.equal(res.code, 400)
  }
  assert.equal(calls.length, 0)
  let res = response(); await handler({ method:'DELETE', query:{ account:'ABC' }, headers:{ 'x-journal-delete': 'DELETE ABC' } }, res)
  assert.equal(res.code, 200); assert.equal(calls[0].args.p_account_id, 'ABC')
  dbError = { message:'failure' }; res = response()
  await handler({ method:'DELETE', query:{}, headers:{ 'x-journal-delete': 'DELETE ALL' } }, res)
  assert.equal(res.code, 503)
})

test('sign-in sends email only to the configured owner and never creates new users', async () => {
  let sent = []
  const handler = compiledModule('../pages/api/auth/sign-in.js', () => ({
    privateResponse() {}, requireMutation: () => true, appUrl: () => 'https://journal.example',
    authClient: () => ({ auth: { signInWithOtp: async args => { sent.push(args); return {} } } }),
  }), { JOURNAL_OWNER_EMAIL: 'owner@example.com' }).default
  let res = response(); await handler({ method:'POST', body:{ email:'attacker@example.com' } }, res)
  assert.equal(res.code, 403); assert.equal(sent.length, 0)
  res = response(); await handler({ method:'POST', body:{ email:'OWNER@example.com' } }, res)
  assert.equal(res.code, 200); assert.equal(sent[0].email, 'owner@example.com')
  assert.equal(sent[0].options.shouldCreateUser, false)
  assert.equal(sent[0].options.emailRedirectTo, 'https://journal.example/auth/callback')
})

test('CSV resource limits are enforced during parsing, including LF-only exports', () => {
  const source = readFileSync(new URL('../pages/api/upload.js', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('function parseCSV('), source.indexOf('export const config'))
  const parse = vm.runInNewContext(fn + '\nparseCSV', { uploadError: safety.uploadError })
  assert.equal(JSON.stringify(parse('a,b\n"c,d",e')), JSON.stringify([['a','b'],['c,d','e']]))
  assert.throws(() => parse('x,'.repeat(301)), /columns/)
  assert.throws(() => parse('x\n'.repeat(100002)), /rows/)
  assert.throws(() => parse('"' + 'x'.repeat(65537) + '"'), /64 KB/)
  assert.throws(() => parse('"broken'), /unterminated/)
})

test('a failed safety backup prevents account deletion', async () => {
 let deleted=false
 const handler=compiledModule('../pages/api/clear.js',path=>{
  if(path.endsWith('/serverAuth'))return {requireOwner:async()=>true}
  if(path.endsWith('/backupStore'))return {createFullBackup:async()=>{throw new Error('Storage down')}}
  if(path==='@supabase/supabase-js')return {createClient:()=>({rpc:async()=>{deleted=true;return {}}})}
  throw new Error(path)
 }).default
 const res=response()
 await handler({method:'DELETE',query:{account:'ABC'},headers:{'x-journal-delete':'DELETE ABC'}},res)
 assert.equal(res.code,503);assert.equal(deleted,false)
})
