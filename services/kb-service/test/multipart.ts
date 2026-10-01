import { randomUUID } from 'node:crypto'

/** Builds a multipart/form-data body the way a browser does (UTF-8 file names, parts in order). */
export function multipart(parts: { name: string; filename?: string; contentType?: string; data: Buffer | string }[]) {
  const boundary = `----helpix${randomUUID()}`
  const chunks: Buffer[] = []
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename !== undefined) head += `; filename="${p.filename}"`
    head += '\r\n'
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`
    chunks.push(Buffer.from(`${head}\r\n`), Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
