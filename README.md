# electrum-client

Strictly typed Electrum Protocol Client (TypeScript) for Node.js, compatible with
[Fulcrum](https://github.com/cculianu/electrum-cash-protocol). BCH compatible.

Created by [Melroy van den Berg](https://melroy.org).

# Based on

- https://github.com/you21979/node-electrum-client
- https://github.com/7kharov/node-electrum-client
- https://github.com/BlueWallet/rn-electrum-client
- https://github.com/janoside/electrum-client
- https://github.com/mempool/electrum-client

# Features

- Persistence (ping strategy and reconnection)
- Batch requests
- Works in nodejs

## Protocol spec

- https://electrum-cash-protocol.readthedocs.io/en/latest/index.html

## Usage

Relies on `net` so will only run in Node.JS environment.

```ts
import { ElectrumClient } from '@bitcoincash/electrum-client'

const client = new ElectrumClient({
  host: 'localhost',
  port: 50002,
  protocol: 'tcp'
})

await client.connect()
```
