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

  // Discard any partially-received message. Must be called when the underlying
  // socket is replaced (reconnect): the buffer may hold the unterminated tail of
  // a response from the dead connection, and concatenating the next socket's
  // bytes onto it would splice two unrelated messages together.
  reset(): void {
    this.buffer = Buffer.alloc(0)
  }

  run(chunk: Buffer | string): void {
    // Accumulate raw bytes. Decoding must happen only on complete, newline-delimited
    // messages: a chunk boundary can fall in the middle of a multi-byte UTF-8
    // sequence, and decoding each chunk independently would corrupt those bytes
    // (producing U+FFFD) and break JSON.parse on large, fragmented responses.
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    this.buffer = this.buffer.length === 0 ? bytes : Buffer.concat([this.buffer, bytes])

    let idx: number
    let n = 0
    while ((idx = this.buffer.indexOf(DELIMITER)) !== -1) {
      // Detach the complete message (and advance the buffer) BEFORE invoking the
      // callback. The callback can synchronously trigger another socket read that
      // re-enters run() and mutates this.buffer; if we kept scanning a cached
      // reference with a captured offset, a freshly-arrived message could be
      // spliced into the middle of the one we're assembling.
      let end = idx
      // Trim a trailing CR so CRLF-terminated servers (e.g. Fulcrum) don't leave
      // a stray '\r' on each decoded message.
      if (end > 0 && this.buffer[end - 1] === 0x0d) {
        end--
      }
      const line = this.buffer.toString('utf8', 0, end)
      this.buffer = this.buffer.subarray(idx + 1)
      if (line.length > 0) {
        this.callback(line, n++)
      }
    }
  }
}
