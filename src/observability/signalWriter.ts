import type {
  SignalCreate,
  BulkSignalsCreate,
  SignalResponse,
} from './signals';
import { getLogger, Logger } from './logger';

const logger = getLogger('zeroeval.signalWriter');

export class SignalWriter {
  private getApiUrl(): string {
    return (process.env.ZEROEVAL_API_URL ?? 'https://api.zeroeval.com').replace(
      /\/$/,
      ''
    );
  }

  private getApiKey(): string | undefined {
    return process.env.ZEROEVAL_API_KEY;
  }

  /**
   * Send a single signal to the backend
   */
  async createSignal(signal: SignalCreate): Promise<SignalResponse> {
    const endpoint = `${this.getApiUrl()}/signals/`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = this.getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // Log request details
    logger.debug(`[ZeroEval] Sending signal to ${endpoint}`);
    if (Logger.isDebugEnabled()) {
      logger.debug('[ZeroEval] Request headers:', {
        ...headers,
        Authorization: headers.Authorization
          ? `Bearer ${Logger.maskApiKey(apiKey)}`
          : undefined,
      });
      logger.debug('[ZeroEval] Request body:', JSON.stringify(signal, null, 2));
    }

    try {
      const startTime = Date.now();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(signal),
      });
      const duration = Date.now() - startTime;

      // Log response details
      logger.debug(
        `[ZeroEval] Response received in ${duration}ms - Status: ${res.status}`
      );

      const text = await res.text();
      if (Logger.isDebugEnabled()) {
        // Log response headers in a Node.js compatible way
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        logger.debug(`[ZeroEval] Response headers:`, responseHeaders);
        logger.debug(`[ZeroEval] Response body:`, text);
      }

      if (!res.ok) {
        logger.error(
          `[ZeroEval] Failed creating signal: ${res.status} ${text}`
        );
        return {
          status: 'error',
          message: `Failed to create signal: ${res.status} ${text}`,
        };
      }

      logger.info(
        `[ZeroEval] Successfully created signal for ${signal.entity_type}:${signal.entity_id} - ${signal.name}`
      );
      return JSON.parse(text) as SignalResponse;
    } catch (err) {
      logger.error('[ZeroEval] Error creating signal', err);
      if (Logger.isDebugEnabled()) {
        logger.debug('[ZeroEval] Error details:', {
          endpoint,
          signal,
          error:
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack,
                }
              : err,
        });
      }
      return {
        status: 'error',
        message: `Error creating signal: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Send multiple signals to the backend in bulk
   */
  async createBulkSignals(signals: SignalCreate[]): Promise<SignalResponse> {
    const endpoint = `${this.getApiUrl()}/signals/bulk`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = this.getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const bulkRequest: BulkSignalsCreate = { signals };

    // Log request details
    logger.debug(
      `[ZeroEval] Sending ${signals.length} bulk signals to ${endpoint}`
    );
    if (Logger.isDebugEnabled()) {
      logger.debug('[ZeroEval] Request headers:', {
        ...headers,
        Authorization: headers.Authorization
          ? `Bearer ${Logger.maskApiKey(apiKey)}`
          : undefined,
      });
      logger.debug(
        '[ZeroEval] Request body:',
        JSON.stringify(bulkRequest, null, 2)
      );
    }

    try {
      const startTime = Date.now();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bulkRequest),
      });
      const duration = Date.now() - startTime;

      // Log response details
      logger.debug(
        `[ZeroEval] Response received in ${duration}ms - Status: ${res.status}`
      );

      const text = await res.text();
      if (Logger.isDebugEnabled()) {
        // Log response headers in a Node.js compatible way
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        logger.debug(`[ZeroEval] Response headers:`, responseHeaders);
        logger.debug(`[ZeroEval] Response body:`, text);
      }

      if (!res.ok) {
        logger.error(
          `[ZeroEval] Failed creating bulk signals: ${res.status} ${text}`
        );
        return {
          status: 'error',
          message: `Failed to create bulk signals: ${res.status} ${text}`,
        };
      }

      logger.info(
        `[ZeroEval] Successfully created ${signals.length} bulk signals`
      );
      return JSON.parse(text) as SignalResponse;
    } catch (err) {
      logger.error('[ZeroEval] Error creating bulk signals', err);
      if (Logger.isDebugEnabled()) {
        logger.debug('[ZeroEval] Error details:', {
          endpoint,
          signalCount: signals.length,
          error:
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack,
                }
              : err,
        });
      }
      return {
        status: 'error',
        message: `Error creating bulk signals: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Get all signals for a specific entity
   */
  async getEntitySignals(entityType: string, entityId: string): Promise<any> {
    const endpoint = `${this.getApiUrl()}/signals/entity/${entityType}/${entityId}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = this.getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // Log request details
    logger.debug(
      `[ZeroEval] Getting signals for ${entityType}:${entityId} from ${endpoint}`
    );
    if (Logger.isDebugEnabled()) {
      logger.debug('[ZeroEval] Request headers:', {
        ...headers,
        Authorization: headers.Authorization
          ? `Bearer ${Logger.maskApiKey(apiKey)}`
          : undefined,
      });
    }

    try {
      const startTime = Date.now();
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
      });
      const duration = Date.now() - startTime;

      // Log response details
      logger.debug(
        `[ZeroEval] Response received in ${duration}ms - Status: ${res.status}`
      );

      const text = await res.text();
      if (Logger.isDebugEnabled()) {
        // Log response headers in a Node.js compatible way
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        logger.debug(`[ZeroEval] Response headers:`, responseHeaders);
        logger.debug(`[ZeroEval] Response body:`, text);
      }

      if (!res.ok) {
        logger.error(
          `[ZeroEval] Failed getting entity signals: ${res.status} ${text}`
        );
        return null;
      }

      logger.info(
        `[ZeroEval] Successfully retrieved signals for ${entityType}:${entityId}`
      );
      return JSON.parse(text);
    } catch (err) {
      logger.error('[ZeroEval] Error getting entity signals', err);
      if (Logger.isDebugEnabled()) {
        logger.debug('[ZeroEval] Error details:', {
          endpoint,
          entityType,
          entityId,
          error:
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack,
                }
              : err,
        });
      }
      return null;
    }
  }
}

// Global singleton instance
export const signalWriter = new SignalWriter();
