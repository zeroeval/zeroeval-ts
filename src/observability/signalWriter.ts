import type {
  SignalCreate,
  BulkSignalsCreate,
  SignalResponse,
} from './signals';

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

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(signal),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[ZeroEval] Failed creating signal: ${res.status} ${text}`
        );
        return {
          status: 'error',
          message: `Failed to create signal: ${res.status} ${text}`,
        };
      }

      return await res.json();
    } catch (err) {
      console.error('[ZeroEval] Error creating signal', err);
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

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bulkRequest),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[ZeroEval] Failed creating bulk signals: ${res.status} ${text}`
        );
        return {
          status: 'error',
          message: `Failed to create bulk signals: ${res.status} ${text}`,
        };
      }

      return await res.json();
    } catch (err) {
      console.error('[ZeroEval] Error creating bulk signals', err);
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

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[ZeroEval] Failed getting entity signals: ${res.status} ${text}`
        );
        return null;
      }

      return await res.json();
    } catch (err) {
      console.error('[ZeroEval] Error getting entity signals', err);
      return null;
    }
  }
}

// Global singleton instance
export const signalWriter = new SignalWriter();
