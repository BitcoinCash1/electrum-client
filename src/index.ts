import { Client } from './lib/client.js'
import { Callbacks, ElectrumConfig, PersistencePolicy } from './types/index.js'

class ElectrumClient extends Client {
  private onConnectCallback: ((client: ElectrumClient, versionInfo: [string, string]) => void) | null
  private onCloseCallback: ((client: ElectrumClient) => void) | null
  private onLogCallback: (str: string) => void
  private timeLastCall: number
  private persistencePolicy: PersistencePolicy | null = null
  private electrumConfig: ElectrumConfig | null = null
  private timeout: NodeJS.Timeout | null
  public versionInfo: [string, string]

  constructor(port: number, host: string, protocol: string, callbacks?: Callbacks) {
    super(port, host, protocol, callbacks)

    this.onConnectCallback = callbacks && callbacks.onConnect ? callbacks.onConnect : null
    this.onCloseCallback = callbacks && callbacks.onClose ? callbacks.onClose : null
    this.onLogCallback =
      callbacks && callbacks.onLog
        ? callbacks.onLog
        : function (str: string) {
            console.log(str)
          }

    this.timeLastCall = 0
    this.timeout = null
    this.versionInfo = ['', '']
  }

  initElectrum(
    electrumConfig: ElectrumConfig,
    persistencePolicy: PersistencePolicy = { retryPeriod: 10000, maxRetry: 1000, pingPeriod: 120000, callback: null }
  ): Promise<ElectrumClient> {
    this.persistencePolicy = persistencePolicy
    this.electrumConfig = electrumConfig
    this.timeLastCall = 0

    return new Promise((resolve, reject) => {
      this.connect()
        .then(() => {
          this.server_version(electrumConfig.client, electrumConfig.version)
            .then((versionInfo) => {
              this.versionInfo = versionInfo

              if (this.onConnectCallback != null) {
                this.onConnectCallback(this, this.versionInfo)
              }

              resolve(this)
            })
            .catch((err) => {
              reject(err)
            })
        })
        .catch((err) => {
          reject(err)
        })
    })
  }

  // Override parent
  request(method: string, params: any[]): Promise<any> {
    this.timeLastCall = new Date().getTime()

    const parentPromise = super.request(method, params)

    return parentPromise.then((response) => {
      this.keepAlive()

      return response
    })
  }

  requestBatch(method: string, params: any[], secondParam?: any): Promise<any> {
    this.timeLastCall = new Date().getTime()

    const parentPromise = super.requestBatch(method, params, secondParam)

    return parentPromise.then((response) => {
      this.keepAlive()

      return response
    })
  }

  onClose(): void {
    super.onClose()

    const list = [
      'server.peers.subscribe',
      'blockchain.numblocks.subscribe',
      'blockchain.headers.subscribe',
      'blockchain.address.subscribe'
    ]

    list.forEach((event) => this.subscribe.removeAllListeners(event))

    let retryPeriod = 10000
    if (this.persistencePolicy?.retryPeriod && this.persistencePolicy.retryPeriod > 0) {
      retryPeriod = this.persistencePolicy.retryPeriod
    }

    if (this.onCloseCallback != null) {
      this.onCloseCallback(this)
    }

    setTimeout(() => {
      if (this.persistencePolicy?.maxRetry && this.persistencePolicy.maxRetry > 0) {
        this.reconnect().catch((err) => {
          this.onError(err)
        })

        this.persistencePolicy.maxRetry -= 1
      } else if (this.persistencePolicy?.callback) {
        this.persistencePolicy.callback()
      } else if (!this.persistencePolicy) {
        this.reconnect().catch((err) => {
          this.onError(err)
        })
      }
    }, retryPeriod)
  }

  // ElectrumX persistancy
  keepAlive(): void {
    if (this.timeout != null) {
      clearTimeout(this.timeout)
    }

    let pingPeriod = 120000
    if (this.persistencePolicy?.pingPeriod && this.persistencePolicy.pingPeriod > 0) {
      pingPeriod = this.persistencePolicy.pingPeriod
    }

    this.timeout = setTimeout(() => {
      if (this.timeLastCall !== 0 && new Date().getTime() > this.timeLastCall + pingPeriod) {
        this.server_ping().catch((reason) => {
          this.log('Keep-Alive ping failed: ' + reason)
        })
      }
    }, pingPeriod)
  }

  close(): void {
    super.close()

    if (this.timeout != null) {
      clearTimeout(this.timeout)
    }

    this.reconnect = () => Promise.resolve(this) // dirty hack to make it stop reconnecting
    this.onClose = () => Promise.resolve(this) // dirty hack to make it stop reconnecting
    this.keepAlive = () => Promise.resolve(this) // dirty hack to make it stop reconnecting
  }

  reconnect(): Promise<ElectrumClient> {
    this.log('Electrum attempting reconnect...')

    this.initSocket()

    if (this.persistencePolicy) {
      return this.initElectrum(this.electrumConfig!, this.persistencePolicy!)
    } else {
      return this.initElectrum(this.electrumConfig!)
    }
  }

  log(str: string): void {
    this.onLogCallback(str)
  }

  // ElectrumX API
  server_version(client_name: string, protocol_version: string | [string, string]): Promise<any> {
    return this.request('server.version', [client_name, protocol_version])
  }
  server_banner(): Promise<any> {
    return this.request('server.banner', [])
  }
  server_features(): Promise<any> {
    return this.request('server.features', [])
  }
  server_ping(): Promise<any> {
    return this.request('server.ping', [])
  }
  server_addPeer(features: any): Promise<any> {
    return this.request('server.add_peer', [features])
  }
  serverDonation_address(): Promise<any> {
    return this.request('server.donation_address', [])
  }
  serverPeers_subscribe(): Promise<any> {
    return this.request('server.peers.subscribe', [])
  }
  blockchainAddress_getProof(address: string): Promise<any> {
    return this.request('blockchain.address.get_proof', [address])
  }
  blockchainScripthash_getBalance(scripthash: string): Promise<any> {
    return this.request('blockchain.scripthash.get_balance', [scripthash])
  }
  blockchainScripthash_getBalanceBatch(scripthash: string[]): Promise<any> {
    return this.requestBatch('blockchain.scripthash.get_balance', scripthash)
  }
  blockchainScripthash_listunspentBatch(scripthash: string[]): Promise<any> {
    return this.requestBatch('blockchain.scripthash.listunspent', scripthash)
  }
  blockchainScripthash_getHistory(scripthash: string): Promise<any> {
    return this.request('blockchain.scripthash.get_history', [scripthash])
  }
  blockchainScripthash_getHistoryBatch(scripthash: string[]): Promise<any> {
    return this.requestBatch('blockchain.scripthash.get_history', scripthash)
  }
  blockchainScripthash_getMempool(scripthash: string): Promise<any> {
    return this.request('blockchain.scripthash.get_mempool', [scripthash])
  }
  blockchainScripthash_listunspent(scripthash: string): Promise<any> {
    return this.request('blockchain.scripthash.listunspent', [scripthash])
  }
  blockchainScripthash_subscribe(scripthash: string): Promise<any> {
    return this.request('blockchain.scripthash.subscribe', [scripthash])
  }
  blockchainBlock_getHeader(height: number): Promise<any> {
    return this.request('blockchain.block.get_header', [height])
  }
  blockchainBlock_headers(start_height: number, count: number): Promise<any> {
    return this.request('blockchain.block.headers', [start_height, count])
  }
  blockchainEstimatefee(number: number): Promise<any> {
    return this.request('blockchain.estimatefee', [number])
  }
  blockchainHeaders_subscribe(raw?: boolean): Promise<any> {
    return this.request('blockchain.headers.subscribe', [raw || false])
  }
  blockchain_relayfee(): Promise<any> {
    return this.request('blockchain.relayfee', [])
  }
  blockchainTransaction_broadcast(rawtx: string): Promise<any> {
    return this.request('blockchain.transaction.broadcast', [rawtx])
  }
  blockchainTransaction_get(tx_hash: string, verbose?: boolean): Promise<any> {
    return this.request('blockchain.transaction.get', [tx_hash, verbose || false])
  }
  blockchainTransaction_getBatch(tx_hash: string[], verbose?: boolean): Promise<any> {
    return this.requestBatch('blockchain.transaction.get', tx_hash, verbose)
  }
  blockchainTransaction_getMerkle(tx_hash: string, height: number): Promise<any> {
    return this.request('blockchain.transaction.get_merkle', [tx_hash, height])
  }
  mempool_getFeeHistogram(): Promise<any> {
    return this.request('mempool.get_fee_histogram', [])
  }
  // ---------------------------------
  // protocol 1.1 deprecated method
  // ---------------------------------
  blockchainUtxo_getAddress(tx_hash: string, index: number): Promise<any> {
    return this.request('blockchain.utxo.get_address', [tx_hash, index])
  }
  blockchainNumblocks_subscribe(): Promise<any> {
    return this.request('blockchain.numblocks.subscribe', [])
  }
  // ---------------------------------
  // protocol 1.2 deprecated method
  // ---------------------------------
  blockchainBlock_getChunk(index: number): Promise<any> {
    return this.request('blockchain.block.get_chunk', [index])
  }
  blockchainAddress_getBalance(address: string): Promise<any> {
    return this.request('blockchain.address.get_balance', [address])
  }
  blockchainAddress_getHistory(address: string): Promise<any> {
    return this.request('blockchain.address.get_history', [address])
  }
  blockchainAddress_getMempool(address: string): Promise<any> {
    return this.request('blockchain.address.get_mempool', [address])
  }
  blockchainAddress_listunspent(address: string): Promise<any> {
    return this.request('blockchain.address.listunspent', [address])
  }
  blockchainAddress_subscribe(address: string): Promise<any> {
    return this.request('blockchain.address.subscribe', [address])
  }
}

export { ElectrumClient }
