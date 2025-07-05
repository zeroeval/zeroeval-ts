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

    const payload = spans.map((s: any) => {
      const base = typeof s.toJSON === 'function' ? s.toJSON() : s;
      return {
        id: base.span_id,
        session_id: base.session_id,
        trace_id: base.trace_id,
        parent_span_id: base.parent_id,
        name: base.name,
        started_at: base.start_time,
        ended_at: base.end_time,
        duration_ms: base.duration_ms,
        attributes: base.attributes,
        status: base.status,
        input_data: base.input_data,
        output_data: base.output_data,
        code: base.code ?? base.attributes?.code,
        code_filepath: base.code_filepath ?? base.attributes?.code_filepath,
        code_lineno: base.code_lineno ?? base.attributes?.code_lineno,
        error_code: base.error_code,
        error_message: base.error_message,
        error_stack: String(base.error_stack ?? ''),
        tags: base.tags,
        trace_tags: base.trace_tags,
        session_tags: base.session_tags,
      };
    });

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
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