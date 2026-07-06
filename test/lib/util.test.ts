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
  })
})
