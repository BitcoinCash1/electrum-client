export const makeRequest = (method: string, params: any[], id: number): string => {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: method,
    params: params,
    id: id
  })
}

export const createPromiseResult = (resolve: (value: any) => void, reject: (reason?: any) => void) => {
  return (err: Error | null, result?: any) => {
    if (err) reject(err)
    else resolve(result)
  }
}

export const createPromiseResultBatch = (
  resolve: (value: any) => void,
  reject: (reason?: any) => void,
  argz: Record<number, any>
) => {
  return (err: Error | null, result?: any) => {
    if (result && result[0] && result[0].id) {
      // this is a batch request response
      for (const r of result) {
        r.param = argz[r.id]
      }
    }
    if (err) reject(err)
    else resolve(result)
  }
}

const DELIMITER = 0x0a // '\n'

export class MessageParser {
  private buffer: Buffer
  private callback: (body: string | undefined, n: number) => void

  constructor(callback: (body: string | undefined, n: number) => void) {
    this.buffer = Buffer.alloc(0)
    this.callback = callback
  }

  run(chunk: Buffer | string): void {
    // Accumulate raw bytes. Decoding must happen only on complete, newline-delimited
    // messages: a chunk boundary can fall in the middle of a multi-byte UTF-8
    // sequence, and decoding each chunk independently would corrupt those bytes
    // (producing U+FFFD) and break JSON.parse on large, fragmented responses.
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    this.buffer = this.buffer.length === 0 ? bytes : Buffer.concat([this.buffer, bytes])

    let start = 0
    let idx: number
    let n = 0
    while ((idx = this.buffer.indexOf(DELIMITER, start)) !== -1) {
      const line = this.buffer.toString('utf8', start, idx)
      if (line.length > 0) {
        this.callback(line, n++)
      }
      start = idx + 1
    }

    // Keep any trailing partial message (no newline yet) for the next chunk.
    this.buffer = start === 0 ? this.buffer : this.buffer.subarray(start)
  }
}
