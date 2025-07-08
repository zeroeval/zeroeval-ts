import { tracer } from './observability/Tracer';

export interface InitOptions {
  apiKey?: string;
  apiUrl?: string;
  flushInterval?: number;
  maxSpans?: number;
  collectCodeDetails?: boolean;
  integrations?: Record<string, boolean>;
}

// Track whether init has been called
let initialized = false;

/**
 * Check if the SDK has been initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Initialise the SDK. Mirrors `ze.init()` from the Python SDK.
 * Stores credentials in process.env for simplicity; callers may also
 * set env vars before requiring the SDK.
 */
export function init(opts: InitOptions = {}): void {
  const {
    apiKey,
    apiUrl,
    flushInterval,
    maxSpans,
    collectCodeDetails,
    integrations,
  } = opts;

  if (apiKey) process.env.ZEROEVAL_API_KEY = apiKey;
  if (apiUrl) process.env.ZEROEVAL_API_URL = apiUrl;

  tracer.configure({
    flushInterval,
    maxSpans,
    collectCodeDetails,
    integrations,
  });

  // Mark as initialized
  initialized = true;
}
