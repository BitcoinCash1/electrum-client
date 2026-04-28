import net from 'net';
import tls from 'tls';
import { EventEmitter } from 'events';
import { TlsSocketWrapper } from './tls-socket-wrapper.js';
import * as util from './util.js';
import { Callbacks, ElectrumRequestBatchParams, ElectrumRequestParams } from '../types/index.js';

const TIMEOUT = 60000;

export abstract class Client {

	protected id: number;
	protected port: number;
	protected host: string;
	protected callback_message_queue: Record<number, (err: Error | null, result?: any) => void>;
	protected subscribe: EventEmitter;
	protected mp: util.MessageParser;
	protected conn: net.Socket | TlsSocketWrapper | null;
	protected status: number;
	private _protocol: string;
	protected onErrorCallback: ((e: Error) => void) | null;

	constructor(port: number, host: string, protocol: string, callbacks?: Callbacks) {
		this.id = 0;
		this.port = port;
		this.host = host;
		this.callback_message_queue = {};
		this.subscribe = new EventEmitter();
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		this.mp = new util.MessageParser((body: string | undefined, n: number) => {
			this.onMessage(body);
		});
		this._protocol = protocol; // saving defaults
		this.conn = null;
		this.status = 0;

		this.onErrorCallback = (callbacks && callbacks.onError) ? callbacks.onError : null;

		this.initSocket(protocol);
	}

	protected initSocket(protocol?: string): void {
		protocol = protocol || this._protocol;
		switch (protocol) {
			case 'tcp':
				this.conn = new net.Socket();
				break;
			case 'tls':
			case 'ssl':
				if (!tls) {
					throw new Error("Package 'tls' not available");
				}

				this.conn = new TlsSocketWrapper(tls);

				break;
			default:
				throw new Error('unknown protocol');
		}

		if (this.conn) {
			this.conn.setTimeout(TIMEOUT);
			this.conn.setEncoding('utf8');
			this.conn.setKeepAlive(true, 0);
			this.conn.setNoDelay(true);
			this.conn.on('connect', () => {
				if (this.conn) this.conn.setTimeout(0);
				this.onConnect();
			});
			this.conn.on('close', () => {
				this.onClose();
			});
			this.conn.on('data', (chunk: Buffer) => {
				if (this.conn) this.conn.setTimeout(0);
				this.onRecv(chunk);
			});
			this.conn.on('error', (e: Error) => {
				this.onError(e);
			});
		}
		this.status = 0;
	}

	protected connect(): Promise<void> {
		if (this.status === 1) {
			return Promise.resolve();
		}
		this.status = 1;
		return this.connectSocket(this.conn!, this.port, this.host);
	}

	private connectSocket(conn: net.Socket | TlsSocketWrapper, port: number, host: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const errorHandler = (e: Error) => reject(e);
			
			conn.on('error', errorHandler);

			conn.connect(port, host, () => {
				conn.removeListener('error', errorHandler);

				resolve();
			});
		});
	}

	close(): void {
		if (this.status === 0) {
			return;
		}
		if (this.conn) {
			this.conn.end();
			this.conn.destroy();
		}
		this.status = 0;
	}

	protected request(method: string, params: ElectrumRequestParams): Promise<any> {
		if (this.status === 0) {
			return Promise.reject(new Error('Connection to server lost, please retry'));
		}
		return new Promise((resolve, reject) => {
			const id = ++this.id;
			const content = util.makeRequest(method, params, id);
			this.callback_message_queue[id] = util.createPromiseResult(resolve, reject);
			if (this.conn) this.conn.write(content + '\n');
		});
	}

	protected requestBatch(method: string, params: ElectrumRequestParams, secondParam?: ElectrumRequestBatchParams): Promise<any> {
		if (this.status === 0) {
			return Promise.reject(new Error('Connection to server lost, please retry'));
		}
		return new Promise((resolve, reject) => {
			const arguments_far_calls: Record<number, any> = {};
			const contents = [];
			for (const param of params) {
				const id = ++this.id;
				if (secondParam !== undefined) {
					contents.push(util.makeRequest(method, [param, secondParam], id));
				} else {
					contents.push(util.makeRequest(method, [param], id));
				}
				arguments_far_calls[id] = param;
			}
			const content = '[' + contents.join(',') + ']';
			this.callback_message_queue[this.id] = util.createPromiseResultBatch(resolve, reject, arguments_far_calls);
			// callback will exist only for max id
			if (this.conn) this.conn.write(content + '\n');
		});
	}

	private response(msg: any): void {
		let callback: ((err: Error | null, result?: any) => void) | undefined;
		if (!msg.id && msg[0] && msg[0].id) {
			// this is a response from batch request
			for (const m of msg) {
				if (m.id && this.callback_message_queue[m.id]) {
					callback = this.callback_message_queue[m.id];
					delete this.callback_message_queue[m.id];
				}
			}
		} else {
			callback = this.callback_message_queue[msg.id];
		}

		if (callback) {
			delete this.callback_message_queue[msg.id];
			if (msg.error) {
				callback(msg.error);
			} else {
				callback(null, msg.result || msg);
			}
		} else {
			throw new Error("Error getting callback while handling response");
		}
	}

	protected onMessage(body: string | undefined): void {
		if (!body) return;
		const msg = JSON.parse(body);
		if (msg instanceof Array) {
			this.response(msg);
		} else {
			if (msg.id !== void 0) {
				this.response(msg);
			} else {
				this.subscribe.emit(msg.method, msg.params);
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	protected onConnect(): void {
	}

	 
	protected onClose(): void {
		this.status = 0;

		Object.keys(this.callback_message_queue).forEach(key => {
			const callback = this.callback_message_queue[Number(key)];
			if (callback) {
				callback(new Error('close connect'));
			}
			delete this.callback_message_queue[Number(key)];
		});
	}

	protected onRecv(chunk: Buffer): void {
		this.mp.run(chunk);
	}

	protected onError(e: Error): void {
		if (this.onErrorCallback != null) {
			this.onErrorCallback(e);
		}
	}
}

