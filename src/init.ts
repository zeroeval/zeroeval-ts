import { tracer } from './observability/Tracer';
import { Logger, getLogger } from './observability/logger';

const logger = getLogger('zeroeval');

export interface InitOptions {
  apiKey?: string;
  apiUrl?: string;
  flushInterval?: number;
  maxSpans?: number;
  collectCodeDetails?: boolean;
  integrations?: Record<string, boolean>;
  debug?: boolean;
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
    debug,
  } = opts;

  // Check if debug mode is enabled via param or env var
  const isDebugMode =
    debug || process.env.ZEROEVAL_DEBUG?.toLowerCase() === 'true';

  // Enable debug mode
  if (isDebugMode) {
    process.env.ZEROEVAL_DEBUG = 'true';
    Logger.setDebugMode(true);

    // Log all configuration values as the first log message
    const maskedApiKey = Logger.maskApiKey(
      apiKey || process.env.ZEROEVAL_API_KEY
    );
    const finalApiUrl =
      apiUrl || process.env.ZEROEVAL_API_URL || 'https://api.zeroeval.com';

    logger.debug('ZeroEval SDK Configuration:');
    logger.debug(`  API Key: ${maskedApiKey}`);
    logger.debug(`  API URL: ${finalApiUrl}`);
    logger.debug(`  Debug Mode: ${isDebugMode}`);
    logger.debug(`  Flush Interval: ${flushInterval ?? '10s (default)'}`);
    logger.debug(`  Max Spans: ${maxSpans ?? '100 (default)'}`);
    logger.debug(
      `  Collect Code Details: ${collectCodeDetails ?? 'true (default)'}`
    );

    logger.info('SDK initialized in debug mode.');
  } else {
    Logger.setDebugMode(false);
  }

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
