export interface RedactionConfig {
  enabled: boolean;
  redactInputs?: boolean;
  redactOutputs?: boolean;
  redactAttributes?: boolean;
  redactErrors?: boolean;
  redactSessionNames?: boolean;
  redactTagValues?: boolean;
  sensitiveKeys?: string[];
  customPatterns?: Array<RegExp | string>;
}

export interface ResolvedRedactionConfig {
  enabled: boolean;
  redactInputs: boolean;
  redactOutputs: boolean;
  redactAttributes: boolean;
  redactErrors: boolean;
  redactSessionNames: boolean;
  redactTagValues: boolean;
  sensitiveKeys: string[];
  customPatterns: RegExp[];
}

export interface RedactionMetadata {
  enabled: true;
  count: number;
  types: string[];
}

export interface RedactionReferenceContext {
  placeholders: Partial<Record<RedactionType, Map<string, string>>>;
  counters: Partial<Record<RedactionType, number>>;
}

type RedactionResult<T> = {
  value: T;
  metadata?: RedactionMetadata;
};

type RedactionTraversalContext = {
  visiting: WeakSet<object>;
  referenceContext?: RedactionReferenceContext;
};

type RedactionType = 'EMAIL' | 'PHONE' | 'SSN' | 'PAN' | 'SECRET' | 'IP';

type StringRedactionOptions = {
  stable?: boolean;
};

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6_REGEX =
  /\b(?:(?:[A-F0-9]{1,4}:){1,7}[A-F0-9]{0,4}|(?:[A-F0-9]{1,4}:){1,7}:|::(?:[A-F0-9]{1,4}:){0,6}[A-F0-9]{0,4})\b/gi;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g;
const API_KEY_REGEX =
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs]-|AIza|ya29|AKIA|ASIA)[A-Za-z0-9._-]{8,}\b/g;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const AUTH_HEADER_REGEX =
  /\b(authorization|proxy-authorization)\s*[:=]\s*[^\r\n]+/gi;
const COOKIE_HEADER_REGEX = /\b(set-cookie|cookie)\s*[:=]\s*[^\r\n]+/gi;
const PHONE_REGEX = /(?:\+?\d[\d().\s-]{7,}\d)/g;
const PAN_CANDIDATE_REGEX = /\b(?:\d[ -]?){13,19}\b/g;
const EXACT_PLACEHOLDER_REGEX = /^\[REDACTED_[A-Z]+(?:_[A-Z0-9]+)?\]$/;

const DEFAULT_SENSITIVE_KEYS = [
  'email',
  'phone',
  'mobile',
  'telephone',
  'ssn',
  'social_security',
  'national_id',
  'tax_id',
  'credit_card',
  'card_number',
  'pan',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'set_cookie',
  'session_name',
  'client_secret',
];

const REDACTION_KEY = 'zeroeval_redaction';

export function resolveRedactionConfig(
  config?: Partial<RedactionConfig>
): ResolvedRedactionConfig {
  const enabled = config?.enabled ?? false;

  return {
    enabled,
    redactInputs: enabled && (config?.redactInputs ?? true),
    redactOutputs: enabled && (config?.redactOutputs ?? true),
    redactAttributes: enabled && (config?.redactAttributes ?? true),
    redactErrors: enabled && (config?.redactErrors ?? true),
    redactSessionNames: enabled && (config?.redactSessionNames ?? true),
    redactTagValues: enabled && (config?.redactTagValues ?? true),
    sensitiveKeys: Array.from(
      new Set(
        [...DEFAULT_SENSITIVE_KEYS, ...(config?.sensitiveKeys ?? [])].map(
          normalizeKey
        )
      )
    ),
    customPatterns: (config?.customPatterns ?? [])
      .map(normalizeCustomPattern)
      .filter((pattern): pattern is RegExp => pattern instanceof RegExp),
  };
}

export function createRedactionReferenceContext(): RedactionReferenceContext {
  return {
    placeholders: {},
    counters: {},
  };
}

export function redactInputValue(
  value: unknown,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<unknown> {
  if (!config.enabled || !config.redactInputs) {
    return { value };
  }
  return redactValue(value, config, createTraversalContext(referenceContext));
}

export function redactOutputValue(
  value: unknown,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<unknown> {
  if (!config.enabled || !config.redactOutputs) {
    return { value };
  }
  return redactValue(value, config, createTraversalContext(referenceContext));
}

export function redactAttributes(
  value: Record<string, unknown> | undefined,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<Record<string, unknown> | undefined> {
  if (!value || !config.enabled || !config.redactAttributes) {
    return { value };
  }
  return redactObject(value, config, createTraversalContext(referenceContext));
}

export function redactTags(
  value: Record<string, string> | undefined,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<Record<string, string> | undefined> {
  if (!value || !config.enabled || !config.redactTagValues) {
    return { value };
  }

  let nextValue: Record<string, string> | undefined;
  let metadata: RedactionMetadata | undefined;

  for (const [key, rawValue] of Object.entries(value)) {
    const redactedValue = isSensitiveKey(key, config)
      ? redactSensitiveValueByType(
          detectRedactionType(rawValue),
          rawValue,
          referenceContext
        )
      : redactString(rawValue, config, {}, referenceContext).value;

    if (!nextValue && redactedValue !== rawValue) {
      nextValue = { ...value };
    }

    if (nextValue) {
      nextValue[key] = redactedValue;
    }

    if (redactedValue !== rawValue) {
      const type = detectRedactionType(rawValue);
      metadata = mergeMetadata(metadata, {
        enabled: true,
        count: 1,
        types: [type],
      });
    }
  }

  return { value: nextValue ?? value, metadata };
}

export function redactSessionName(
  value: string | undefined,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<string | undefined> {
  if (!value || !config.enabled || !config.redactSessionNames) {
    return { value };
  }

  return redactString(value, config, {}, referenceContext);
}

export function redactSessionIdentifier(
  value: string | undefined,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<string | undefined> {
  if (!value || !config.enabled) {
    return { value };
  }

  if (isExactPlaceholder(value)) {
    return { value };
  }

  const type = detectExactMatchType(value, config);
  if (!type) {
    return { value };
  }

  return {
    value: redactSensitiveValueByType(type, value, referenceContext),
    metadata: {
      enabled: true,
      count: 1,
      types: [type],
    },
  };
}

export function redactErrorInfo(
  error: { code?: string; message?: string; stack?: string } | undefined,
  config: ResolvedRedactionConfig,
  referenceContext?: RedactionReferenceContext
): RedactionResult<
  { code?: string; message?: string; stack?: string } | undefined
> {
  if (!error || !config.enabled || !config.redactErrors) {
    return { value: error };
  }

  const message: RedactionResult<string | undefined> = error.message
    ? redactString(error.message, config, {}, referenceContext)
    : { value: error.message };
  const stack: RedactionResult<string | undefined> = error.stack
    ? redactString(error.stack, config, {}, referenceContext)
    : { value: error.stack };

  const metadata = mergeMetadata(message.metadata, stack.metadata);
  if (!metadata) {
    return { value: error };
  }

  return {
    value: {
      ...error,
      message: message.value,
      stack: stack.value,
    },
    metadata,
  };
}

export function attachRedactionMetadata(
  attributes: Record<string, unknown>,
  metadata?: RedactionMetadata
): void {
  if (!metadata) {
    return;
  }

  const existing = parseExistingMetadata(attributes[REDACTION_KEY]);
  attributes[REDACTION_KEY] = existing
    ? {
        enabled: true,
        count: existing.count + metadata.count,
        types: Array.from(new Set([...existing.types, ...metadata.types])),
      }
    : metadata;
}

export function safeSerialize(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === 'bigint') {
      return currentValue.toString();
    }

    if (typeof currentValue === 'function') {
      return `[Function ${currentValue.name || 'anonymous'}]`;
    }

    if (
      typeof currentValue === 'object' &&
      currentValue !== null &&
      !(currentValue instanceof Date)
    ) {
      if (seen.has(currentValue)) {
        return '[Circular]';
      }
      seen.add(currentValue);
    }

    return currentValue;
  });
}

function redactValue(
  value: unknown,
  config: ResolvedRedactionConfig,
  context: RedactionTraversalContext
): RedactionResult<unknown> {
  if (typeof value === 'string') {
    if (looksLikeJson(value)) {
      const parsed = tryParseJson(value);
      if (parsed !== undefined) {
        return redactValue(parsed, config, context);
      }
    }

    return redactString(value, config, {}, context.referenceContext);
  }

  if (Array.isArray(value)) {
    if (context.visiting.has(value)) {
      return { value: '[Circular]' };
    }

    return redactArray(value, config, context);
  }

  if (value && typeof value === 'object') {
    if (context.visiting.has(value)) {
      return { value: '[Circular]' };
    }

    return redactObject(value as Record<string, unknown>, config, context);
  }

  return { value };
}

function redactArray(
  value: unknown[],
  config: ResolvedRedactionConfig,
  context: RedactionTraversalContext
): RedactionResult<unknown[]> {
  context.visiting.add(value);

  let nextValue: unknown[] | undefined;
  let metadata: RedactionMetadata | undefined;

  try {
    value.forEach((item, index) => {
      const redacted = redactValue(item, config, context);
      if (!nextValue && redacted.value !== item) {
        nextValue = [...value];
      }

      if (nextValue) {
        nextValue[index] = redacted.value;
      }

      metadata = mergeMetadata(metadata, redacted.metadata);
    });
  } finally {
    context.visiting.delete(value);
  }

  return { value: nextValue ?? value, metadata };
}

function redactObject(
  value: Record<string, unknown>,
  config: ResolvedRedactionConfig,
  context: RedactionTraversalContext
): RedactionResult<Record<string, unknown>> {
  context.visiting.add(value);

  let nextValue: Record<string, unknown> | undefined;
  let metadata: RedactionMetadata | undefined;

  try {
    for (const [key, rawValue] of Object.entries(value)) {
      let redacted: RedactionResult<unknown>;

      if (isSensitiveKey(key, config)) {
        const type = detectRedactionType(rawValue);
        redacted = {
          value: redactSensitiveValueByType(
            type,
            rawValue,
            context.referenceContext
          ),
          metadata: {
            enabled: true,
            count: 1,
            types: [type],
          },
        };
      } else {
        redacted = redactValue(rawValue, config, context);
      }

      if (!nextValue && redacted.value !== rawValue) {
        nextValue = { ...value };
      }

      if (nextValue) {
        nextValue[key] = redacted.value;
      }

      metadata = mergeMetadata(metadata, redacted.metadata);
    }
  } finally {
    context.visiting.delete(value);
  }

  return { value: nextValue ?? value, metadata };
}

function createTraversalContext(
  referenceContext?: RedactionReferenceContext
): RedactionTraversalContext {
  return {
    visiting: new WeakSet<object>(),
    referenceContext,
  };
}

function redactString(
  value: string,
  config: ResolvedRedactionConfig,
  options: StringRedactionOptions = {},
  referenceContext?: RedactionReferenceContext
): RedactionResult<string> {
  if (isExactPlaceholder(value)) {
    return { value };
  }

  let nextValue = value;
  let metadata: RedactionMetadata | undefined;

  const exactType = options.stable ? detectExactMatchType(value, config) : null;
  if (exactType) {
    return {
      value: redactSensitiveValueByType(exactType, value, referenceContext),
      metadata: {
        enabled: true,
        count: 1,
        types: [exactType],
      },
    };
  }

  nextValue = replaceWithMetadata(
    nextValue,
    AUTH_HEADER_REGEX,
    'SECRET',
    (_match, headerName, headerValue) =>
      `${headerName}: ${redactSensitiveValueByType(
        'SECRET',
        headerValue,
        referenceContext
      )}`,
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    COOKIE_HEADER_REGEX,
    'SECRET',
    (_match, headerName, headerValue) =>
      `${headerName}: ${redactSensitiveValueByType(
        'SECRET',
        headerValue,
        referenceContext
      )}`,
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    BEARER_REGEX,
    'SECRET',
    (match) =>
      `Bearer ${redactSensitiveValueByType(
        'SECRET',
        match.replace(/^Bearer\s+/i, ''),
        referenceContext
      )}`,
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    JWT_REGEX,
    'SECRET',
    (match) => redactSensitiveValueByType('SECRET', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    API_KEY_REGEX,
    'SECRET',
    (match) => redactSensitiveValueByType('SECRET', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replacePanCandidates(
    nextValue,
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    SSN_REGEX,
    'SSN',
    (match) => redactSensitiveValueByType('SSN', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    EMAIL_REGEX,
    'EMAIL',
    (match) => redactSensitiveValueByType('EMAIL', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    PHONE_REGEX,
    'PHONE',
    (match) => redactSensitiveValueByType('PHONE', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    IPV4_REGEX,
    'IP',
    (match) => redactSensitiveValueByType('IP', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );
  nextValue = replaceWithMetadata(
    nextValue,
    IPV6_REGEX,
    'IP',
    (match) => redactSensitiveValueByType('IP', match, referenceContext),
    (metadataRef) => {
      metadata = mergeMetadata(metadata, metadataRef);
    },
    referenceContext
  );

  for (const pattern of config.customPatterns) {
    nextValue = replaceWithMetadata(
      nextValue,
      pattern,
      'SECRET',
      (match) => redactSensitiveValueByType('SECRET', match, referenceContext),
      (metadataRef) => {
        metadata = mergeMetadata(metadata, metadataRef);
      },
      referenceContext
    );
  }

  return {
    value: nextValue,
    metadata,
  };
}

function replacePanCandidates(
  value: string,
  onMatch: (metadata: RedactionMetadata) => void,
  referenceContext?: RedactionReferenceContext
): string {
  PAN_CANDIDATE_REGEX.lastIndex = 0;
  return value.replace(PAN_CANDIDATE_REGEX, (matched) => {
    const digits = matched.replace(/[ -]/g, '');
    if (!isLikelyPan(digits)) {
      return matched;
    }

    onMatch({
      enabled: true,
      count: 1,
      types: ['PAN'],
    });
    return redactSensitiveValueByType('PAN', matched, referenceContext);
  });
}

function replaceWithMetadata(
  value: string,
  pattern: RegExp,
  type: RedactionType,
  replacement: (...args: string[]) => string,
  onMatch: (metadata: RedactionMetadata) => void,
  _referenceContext?: RedactionReferenceContext
): string {
  pattern.lastIndex = 0;
  let matchCount = 0;
  const result = value.replace(pattern, (...args) => {
    matchCount += 1;
    return replacement(...(args as string[]));
  });
  pattern.lastIndex = 0;

  if (matchCount > 0) {
    onMatch({
      enabled: true,
      count: matchCount,
      types: [type],
    });
  }

  return result;
}

function createPlaceholderForValue(value: unknown): string {
  return redactSensitiveValueByType(detectRedactionType(value), value);
}

function createPlaceholder(type: RedactionType, suffix?: string): string {
  return suffix ? `[REDACTED_${type}_${suffix}]` : `[REDACTED_${type}]`;
}

function detectRedactionType(value: unknown): RedactionType {
  if (typeof value !== 'string') {
    return 'SECRET';
  }

  const exactType = detectExactMatchType(
    value,
    resolveRedactionConfig({ enabled: true })
  );
  return exactType ?? (value.includes('@') ? 'EMAIL' : 'SECRET');
}

function detectExactMatchType(
  value: string,
  config: ResolvedRedactionConfig
): RedactionType | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  EMAIL_REGEX.lastIndex = 0;
  const emailMatch = EMAIL_REGEX.exec(trimmed);
  EMAIL_REGEX.lastIndex = 0;
  if (
    emailMatch &&
    emailMatch.index === 0 &&
    emailMatch.index + emailMatch[0].length === trimmed.length
  ) {
    return 'EMAIL';
  }

  SSN_REGEX.lastIndex = 0;
  const ssnMatch = SSN_REGEX.exec(trimmed);
  SSN_REGEX.lastIndex = 0;
  if (
    ssnMatch &&
    ssnMatch.index === 0 &&
    ssnMatch.index + ssnMatch[0].length === trimmed.length
  ) {
    return 'SSN';
  }

  if (
    BEARER_REGEX.test(trimmed) ||
    JWT_REGEX.test(trimmed) ||
    API_KEY_REGEX.test(trimmed) ||
    AUTH_HEADER_REGEX.test(trimmed) ||
    COOKIE_HEADER_REGEX.test(trimmed)
  ) {
    resetGlobalRegexes();
    return 'SECRET';
  }
  resetGlobalRegexes();

  IPV4_REGEX.lastIndex = 0;
  const ipv4Match = IPV4_REGEX.exec(trimmed);
  IPV4_REGEX.lastIndex = 0;
  if (
    ipv4Match &&
    ipv4Match.index === 0 &&
    ipv4Match.index + ipv4Match[0].length === trimmed.length
  ) {
    return 'IP';
  }

  IPV6_REGEX.lastIndex = 0;
  const ipv6Match = IPV6_REGEX.exec(trimmed);
  IPV6_REGEX.lastIndex = 0;
  if (
    ipv6Match &&
    ipv6Match.index === 0 &&
    ipv6Match.index + ipv6Match[0].length === trimmed.length
  ) {
    return 'IP';
  }

  const phoneCandidate = trimmed.replace(/[\s().-]/g, '');
  PHONE_REGEX.lastIndex = 0;
  const phoneMatch = PHONE_REGEX.exec(trimmed);
  PHONE_REGEX.lastIndex = 0;
  if (
    phoneMatch &&
    phoneMatch.index === 0 &&
    phoneMatch.index + phoneMatch[0].length === trimmed.length &&
    phoneCandidate.length >= 8 &&
    phoneCandidate.length <= 15
  ) {
    return 'PHONE';
  }

  const panDigits = trimmed.replace(/[ -]/g, '');
  if (isLikelyPan(panDigits)) {
    return 'PAN';
  }

  for (const pattern of config.customPatterns) {
    if (pattern.test(trimmed)) {
      pattern.lastIndex = 0;
      return 'SECRET';
    }
    pattern.lastIndex = 0;
  }

  return null;
}

function isSensitiveKey(key: string, config: ResolvedRedactionConfig): boolean {
  const normalized = normalizeKey(key);
  return config.sensitiveKeys.some(
    (sensitiveKey) =>
      normalized === sensitiveKey ||
      normalized.endsWith(`_${sensitiveKey}`) ||
      normalized.endsWith(`.${sensitiveKey}`)
  );
}

function redactSensitiveValueByType(
  type: RedactionType,
  rawValue: unknown,
  referenceContext?: RedactionReferenceContext
): string {
  const rawString = String(rawValue ?? '');
  if (isExactPlaceholder(rawString)) {
    return rawString;
  }

  const normalized = normalizeSensitiveValue(type, rawString);
  if (!normalized) {
    return createPlaceholder(type);
  }

  if (!referenceContext) {
    return createPlaceholder(type);
  }

  const mapping =
    referenceContext.placeholders[type] ??
    (referenceContext.placeholders[type] = new Map<string, string>());
  const existing = mapping.get(normalized);
  if (existing) {
    return existing;
  }

  const nextIndex = (referenceContext.counters[type] ?? 0) + 1;
  referenceContext.counters[type] = nextIndex;
  const placeholder = createPlaceholder(type, toPlaceholderSuffix(nextIndex));
  mapping.set(normalized, placeholder);
  return placeholder;
}

function normalizeSensitiveValue(type: RedactionType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isExactPlaceholder(trimmed)) {
    return trimmed;
  }

  switch (type) {
    case 'EMAIL':
      return trimmed.toLowerCase();
    case 'PHONE':
      return trimmed.replace(/\D/g, '');
    case 'SSN':
      return trimmed.replace(/\D/g, '');
    case 'PAN':
      return trimmed.replace(/\D/g, '');
    case 'IP':
      return trimmed.toLowerCase();
    case 'SECRET':
    default:
      return trimmed;
  }
}

function isExactPlaceholder(value: string): boolean {
  return EXACT_PLACEHOLDER_REGEX.test(value.trim());
}

function toPlaceholderSuffix(index: number): string {
  let current = index;
  let suffix = '';

  while (current > 0) {
    current -= 1;
    suffix = String.fromCharCode(65 + (current % 26)) + suffix;
    current = Math.floor(current / 26);
  }

  return suffix || 'A';
}

function normalizeCustomPattern(pattern: RegExp | string): RegExp | undefined {
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.includes('g')
      ? pattern.flags
      : `${pattern.flags}g`;
    return new RegExp(pattern.source, flags);
  }

  const inlineMatch = pattern.match(/^\/(.+)\/([dgimsuvy]*)$/);
  if (inlineMatch) {
    const flags = inlineMatch[2].includes('g')
      ? inlineMatch[2]
      : `${inlineMatch[2]}g`;
    return new RegExp(inlineMatch[1], flags);
  }

  return new RegExp(escapeRegExp(pattern), 'g');
}

function mergeMetadata(
  left?: RedactionMetadata,
  right?: RedactionMetadata
): RedactionMetadata | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    enabled: true,
    count: left.count + right.count,
    types: Array.from(new Set([...left.types, ...right.types])),
  };
}

function parseExistingMetadata(value: unknown): RedactionMetadata | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('enabled' in value) ||
    !('count' in value) ||
    !('types' in value)
  ) {
    return undefined;
  }

  const candidate = value as RedactionMetadata;
  if (
    candidate.enabled !== true ||
    typeof candidate.count !== 'number' ||
    !Array.isArray(candidate.types)
  ) {
    return undefined;
  }

  return candidate;
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resetGlobalRegexes(): void {
  BEARER_REGEX.lastIndex = 0;
  JWT_REGEX.lastIndex = 0;
  API_KEY_REGEX.lastIndex = 0;
  AUTH_HEADER_REGEX.lastIndex = 0;
  COOKIE_HEADER_REGEX.lastIndex = 0;
}

function isLikelyPan(value: string): boolean {
  if (!/^\d{13,19}$/.test(value)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
