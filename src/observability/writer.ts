export interface SpanWriter {
  write(spans: any[]): void | Promise<void>;
}

export class BackendSpanWriter implements SpanWriter {
  private apiUrl = (process.env.ZEROEVAL_API_URL ?? 'https://api.zeroeval.com').replace(/\/$/, '');

  private getApiKey(): string | undefined {
    return process.env.ZEROEVAL_API_KEY;
  }

  async write(spans: any[]): Promise<void> {
    if (!spans.length) return;

    const endpoint = `${this.apiUrl}/spans`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(spans.map((s) => (typeof s.toJSON === 'function' ? s.toJSON() : s))),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const text = await res.text();
        console.error(`[ZeroEval] Failed posting spans: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error('[ZeroEval] Error posting spans', err);
    }
  }
} 