import { ElectrumClient } from '../index';

export type Protocol = 'tcp' | 'tls' | 'ssl';

export interface Callbacks {
  onConnect?: (client: ElectrumClient, versionInfo: [string, string]) => void;
  onClose?: (client: ElectrumClient) => void;
  onLog?: (str: string) => void;
  onError?: (e: Error) => void;
}

export interface PersistencePolicy {
  retryPeriod?: number;
  maxRetry?: number;
  pingPeriod?: number;
  callback?: (() => void) | null;
}

export interface ElectrumConfig {
  client: string;
  version: string | [string, string];
}

export type ElectrumRequestParams = (number | string | boolean | any[])[];

export type ElectrumRequestBatchParams = number | string | boolean | undefined;
