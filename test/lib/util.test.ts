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
})
