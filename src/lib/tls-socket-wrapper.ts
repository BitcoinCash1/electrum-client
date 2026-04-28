import tls from 'tls';

/**
 * Simple wrapper to mimick Socket class from NET package, since TLS package has slightly different API.
 * We implement several methods that TCP sockets are expected to have. We will proxy call them as soon as
 * real TLS socket will be created (TLS socket created after connection).
 */
export class TlsSocketWrapper {
	private _tls: typeof tls;
	private _socket: tls.TLSSocket | null;
	private _timeout: number;
	private _encoding: string;
	private _keepAliveEneblad: boolean;
	private _keepAliveinitialDelay: number;
	private _noDelay: boolean;
	private _listeners: Record<string, ((...args: any[]) => void)[]>;

	constructor(tlsModule: typeof tls) {
		this._tls = tlsModule; // dependency injection lol
		this._socket = null;
		// defaults:
		this._timeout = 5000;
		this._encoding = 'utf8' as BufferEncoding;
		this._keepAliveEneblad = true;
		this._keepAliveinitialDelay = 0;
		this._noDelay = true;
		this._listeners = {};
	}

	setTimeout(timeout: number): void {
		if (this._socket) this._socket.setTimeout(timeout);
		this._timeout = timeout;
	}

	setEncoding(encoding: BufferEncoding): void {
		if (this._socket) this._socket.setEncoding(encoding);
		this._encoding = encoding;
	}

	setKeepAlive(enabled: boolean, initialDelay: number): void {
		if (this._socket) this._socket.setKeepAlive(enabled, initialDelay);
		this._keepAliveEneblad = enabled;
		this._keepAliveinitialDelay = initialDelay;
	}

	setNoDelay(noDelay: boolean): void {
		if (this._socket) this._socket.setNoDelay(noDelay);
		this._noDelay = noDelay;
	}

	on(event: string, listener: (...args: any[]) => void): void {
		this._listeners[event] = this._listeners[event] || [];
		this._listeners[event].push(listener);
	}

	removeListener(event: string, listener: (...args: any[]) => void): void {
		this._listeners[event] = this._listeners[event] || [];
		const newListeners: ((...args: any[]) => void)[] = [];

		let found = false;
		for (const savedListener of this._listeners[event]) {
			if (savedListener == listener) {
				// found our listener
				found = true;
				// we just skip it
			} else {
				// other listeners should go back to original array
				newListeners.push(savedListener);
			}
		}

		if (found) {
			this._listeners[event] = newListeners;
		} else {
			// something went wrong, lets just cleanup all listeners
			this._listeners[event] = [];
		}
	}

	connect(port: number, host: string, callback: () => void): void {
		// resulting TLSSocket extends <net.Socket>
		this._socket = this._tls.connect({ port: port, host: host, rejectUnauthorized: false }, () => {
			return callback();
		});

		// setting everything that was set to this proxy class

		if (this._socket) {
			this._socket.setTimeout(this._timeout);
			this._socket.setEncoding(this._encoding as BufferEncoding);
			this._socket.setKeepAlive(this._keepAliveEneblad, this._keepAliveinitialDelay);
			this._socket.setNoDelay(this._noDelay);

			// resubscribing to events on newly created socket so we could proxy them to already established listeners

			this._socket.on('data', (data: any) => {
				this._passOnEvent('data', data);
			});
			this._socket.on('error', (data: any) => {
				this._passOnEvent('error', data);
			});
			this._socket.on('close', (data: any) => {
				this._passOnEvent('close', data);
			});
			this._socket.on('connect', (data: any) => {
				this._passOnEvent('connect', data);
			});
			this._socket.on('connection', (data: any) => {
				this._passOnEvent('connection', data);
			});
		}
	}

	private _passOnEvent(event: string, data: any): void {
		this._listeners[event] = this._listeners[event] || [];
		for (const savedListener of this._listeners[event]) {
			savedListener(data);
		}
	}

	emit(event: string, data: any): void {
		if (this._socket) {
			this._socket.emit(event, data);
		}
	}

	end(): void {
		if (this._socket) {
			this._socket.end();
		}
	}

	destroy(): void {
		if (this._socket) {
			this._socket.destroy();
		}
	}

	write(data: string | Buffer): void {
		if (this._socket) {
			this._socket.write(data);
		}
	}
}

