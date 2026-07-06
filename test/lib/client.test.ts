/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, test, assert } from 'vitest'

// SUT
import { ElectrumClient } from '../../src'

// These tests exercise onMessage's parsing/dispatch in isolation, without a
// network connection. Messages are driven through the client's MessageParser,
// which is exactly how real socket data reaches onMessage.

const makeClient = (onError?: (e: Error) => void, onSubscribe?: (method: string, params: unknown) => void) => {
  const client = new ElectrumClient(50001, '127.0.0.1', 'tcp', { onError })
  if (onSubscribe) {
    // @ts-ignore access protected subscribe emitter for assertions
    client.subscribe.on('server.something', (params: unknown) => onSubscribe('server.something', params))
  }
  return client
}

// Feed a complete, newline-delimited message the way onRecv would.
const feed = (client: ElectrumClient, message: string) => {
  // @ts-ignore access protected message parser
  client.mp.run(Buffer.from(message + '\n', 'utf8'))
}

describe('Client.onMessage', () => {
  test('a malformed message does not throw and is reported via onError', () => {
    const errors: Error[] = []
    const client = makeClient((e) => errors.push(e))

    // Corrupt JSON: a value replaced with the UTF-8 replacement char, mimicking
    // the chunk-boundary decode corruption this library used to produce.
    const corrupt = '{"id":1,"jsonrpc":"2.0","result":"aa�bb"' // missing closing brace too

    assert.doesNotThrow(() => feed(client, corrupt))
    assert.strictEqual(errors.length, 1)
    assert.match(errors[0]!.message, /Failed to parse Electrum message/)

    client.close()
  })

  test('the reported error includes a context window around the failure position', () => {
    const errors: Error[] = []
    const client = makeClient((e) => errors.push(e))

    // Build a large object whose closing quote is broken, so the parse error
    // lands deep into the string and the context window must be a slice.
    const filler = 'x'.repeat(5000)
    const broken = `{"jsonrpc":"2.0","id":1,"result":"${filler}` + '}' // string never closed

    feed(client, broken)

    assert.strictEqual(errors.length, 1)
    const msg = errors[0]!.message
    assert.match(msg, /length=\d+/)
    // Context is a bounded slice, not the whole multi-KB body.
    assert.ok(msg.length < broken.length, 'error message should not embed the full body')

    client.close()
  })

  test('a subsequent valid message is still dispatched after a bad one', () => {
    const errors: Error[] = []
    const subscriptions: unknown[] = []
    const client = makeClient(
      (e) => errors.push(e),
      (_method, params) => subscriptions.push(params)
    )

    feed(client, '{"broken":') // malformed -> onError, no throw
    feed(client, '{"jsonrpc":"2.0","method":"server.something","params":[42]}') // valid notification

    assert.strictEqual(errors.length, 1)
    assert.deepStrictEqual(subscriptions, [[42]])

    client.close()
  })

  test('two messages arriving in one chunk are both dispatched', () => {
    const subscriptions: unknown[] = []
    const client = makeClient(undefined, (_m, params) => subscriptions.push(params))

    // Both notifications in a single buffer (with a trailing newline via feed).
    feed(
      client,
      '{"jsonrpc":"2.0","method":"server.something","params":[1]}\n' +
        '{"jsonrpc":"2.0","method":"server.something","params":[2]}'
    )

    assert.deepStrictEqual(subscriptions, [[1], [2]])

    client.close()
  })
})
