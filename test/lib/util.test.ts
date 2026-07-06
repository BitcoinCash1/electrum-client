import { describe, test, assert } from 'vitest'

// SUT
import * as util from '../../src/lib/util.js'

describe('util package', () => {
  describe('makeRequest()', () => {
    test('should make a correct request payload', () => {
      const expected = '{"jsonrpc":"2.0","method":"testMethod","params":["stringParam",1,true],"id":1}'
      const request = util.makeRequest('testMethod', ['stringParam', 1, true], 1)

      assert.strictEqual(request, expected)
    })
  })

  describe('MessageParser', () => {
    test('emits complete newline-delimited messages', () => {
      const out: string[] = []
      const mp = new util.MessageParser((body) => out.push(body!))
      mp.run(Buffer.from('{"a":1}\n{"b":2}\n'))

      assert.deepStrictEqual(out, ['{"a":1}', '{"b":2}'])
    })

    test('buffers a partial message until its newline arrives', () => {
      const out: string[] = []
      const mp = new util.MessageParser((body) => out.push(body!))
      mp.run(Buffer.from('{"a":'))
      assert.deepStrictEqual(out, [])
      mp.run(Buffer.from('1}\n'))
      assert.deepStrictEqual(out, ['{"a":1}'])
    })

    test('reset() discards a partial message so a reconnect does not splice streams', () => {
      // Simulates a disconnect mid-response followed by a reconnect: the buffer
      // holds the unterminated tail of the dead connection's message, then the
      // new socket's first (complete) message arrives. Without reset() the two
      // would be concatenated and fail to parse.
      const out: string[] = []
      const mp = new util.MessageParser((body) => out.push(body!))

      // Partial, unterminated message from the connection that just died.
      mp.run(Buffer.from('{"result":["deadbeef","cafe'))
      assert.deepStrictEqual(out, [], 'nothing emitted yet (no newline)')

      // Socket replaced on reconnect -> parser state must be cleared.
      mp.reset()

      // Fresh, complete message on the new socket.
      mp.run(Buffer.from('{"id":15,"jsonrpc":"2.0","result":["Fulcrum 2.1.1","1.6"]}\n'))

      assert.strictEqual(out.length, 1)
      assert.doesNotThrow(() => JSON.parse(out[0]!))
      assert.strictEqual(JSON.parse(out[0]!).id, 15)
    })

    test('reassembles a multi-byte UTF-8 char split across chunk boundaries', () => {
      // A single message containing a 4-byte emoji (😀 => F0 9F 98 80),
      // split so the sequence straddles two chunks. Decoding chunks
      // independently would corrupt it; the parser must decode the whole line.
      const message = '{"emoji":"😀"}'
      const bytes = Buffer.from(message + '\n', 'utf8')
      const nl = bytes.length - 1
      // Split in the middle of the emoji's byte sequence.
      const emojiStart = Buffer.from('{"emoji":"', 'utf8').length
      const splitAt = emojiStart + 2

      const out: string[] = []
      const mp = new util.MessageParser((body) => out.push(body!))
      mp.run(bytes.subarray(0, splitAt))
      mp.run(bytes.subarray(splitAt, nl + 1))

      assert.deepStrictEqual(out, [message])
      assert.strictEqual(JSON.parse(out[0]!).emoji, '😀')
    })

    test('handles many messages in a single chunk (no depth limit)', () => {
      const count = 100
      let payload = ''
      for (let i = 0; i < count; i++) payload += `{"i":${i}}\n`

      const out: string[] = []
      const mp = new util.MessageParser((body) => out.push(body!))
      mp.run(Buffer.from(payload, 'utf8'))

      assert.strictEqual(out.length, count)
      assert.strictEqual(JSON.parse(out[count - 1]!).i, count - 1)
    })

    test('strips a trailing CR from CRLF-terminated messages', () => {
      const out: string[] = []
      const mp = new util.MessageParser((body) => out.push(body!))
      mp.run(Buffer.from('{"a":1}\r\n{"b":2}\r\n'))

      assert.deepStrictEqual(out, ['{"a":1}', '{"b":2}'])
    })

    test('does not corrupt an in-flight message when the callback re-enters run()', () => {
      // Reproduces the interleaving bug: a callback synchronously feeds another
      // chunk (as a real socket read would), mutating the buffer while the outer
      // loop is still iterating. A cached buffer reference with a captured offset
      // would splice the injected message into the middle of a later one.
      const out: string[] = []
      let injected = false
      const mp = new util.MessageParser((body) => {
        out.push(body!)
        if (!injected) {
          injected = true
          // Re-enter with a complete extra message while still inside run().
          mp.run(Buffer.from('{"injected":true}\n'))
        }
      })

      // First message triggers the re-entrant injection; a large second message
      // must survive intact and parse cleanly.
      const big = '{"result":"' + 'a'.repeat(5000) + '"}'
      mp.run(Buffer.from('{"first":1}\n' + big + '\n'))

      assert.strictEqual(out.length, 3)
      // Every emitted message must be valid, unspliced JSON. Delivery order is
      // not guaranteed across re-entrancy, so assert on content by identity.
      const parsed = out.map((line) => {
        let obj: any
        assert.doesNotThrow(() => (obj = JSON.parse(line)))
        return obj
      })
      assert.ok(
        parsed.some((o) => o.first === 1),
        'first message intact'
      )
      assert.ok(
        parsed.some((o) => o.injected === true),
        'injected message intact'
      )
      assert.ok(
        parsed.some((o) => o.result && o.result.length === 5000),
        'large message intact and not spliced'
      )
    })
  })
})
