/**
 * A/B testing choice function for the TypeScript SDK.
 * Mirrors the Python SDK's ze.choose() behaviour:
 *   - weighted random variant selection
 *   - per-entity caching within the same context
 *   - backend round-trip for experiment tracking
 *   - attaches ab_choice metadata to the current span
 */

import { tracer } from './observability/Tracer';
import { getLogger } from './observability/logger';
import { getApiUrl, getApiKey } from './utils/api';

const logger = getLogger('zeroeval.choice');

const choiceCache = new Map<string, string>();

export interface ChooseOptions {
  name: string;
  variants: Record<string, unknown>;
  weights: Record<string, number>;
  durationDays: number;
  defaultVariant?: string;
}

export async function choose(options: ChooseOptions): Promise<unknown> {
  const { name, variants, weights, durationDays, defaultVariant } = options;

  const variantKeys = Object.keys(variants);
  if (variantKeys.length === 0) throw new Error('variants must not be empty');
  if (Object.keys(weights).length === 0) throw new Error('weights must not be empty');
  if (durationDays <= 0) throw new Error('durationDays must be > 0');

  const variantSet = new Set(variantKeys);
  const weightSet = new Set(Object.keys(weights));
  if (variantSet.size !== weightSet.size || ![...variantSet].every((k) => weightSet.has(k))) {
    throw new Error('variant keys must match weight keys');
  }

  const fallback = defaultVariant ?? variantKeys[0];
  if (!(fallback in variants)) throw new Error(`defaultVariant '${fallback}' not in variants`);

  const currentSpan = tracer.currentSpan();
  if (!currentSpan) {
    throw new Error(
      'ze.choose() must be called within an active span context. ' +
        'Wrap the call inside ze.span() or ze.withSpan().'
    );
  }

  const entityType = 'span';
  const entityId = currentSpan.spanId;
  const cacheKey = `${entityType}:${entityId}:${name}`;

  if (choiceCache.has(cacheKey)) {
    const cached = choiceCache.get(cacheKey)!;
    return variants[cached];
  }

  const selectedKey = weightedRandomChoice(variantKeys, weights);

  let responseData: Record<string, unknown> | null = null;
  try {
    responseData = await sendChoiceData({
      entityType,
      entityId,
      choiceName: name,
      variantKey: selectedKey,
      variantValue: String(variants[selectedKey]),
      variants,
      weights,
      durationDays,
    });
  } catch (err) {
    logger.error('[ZeroEval] Failed to send choice data', err);
  }

  if (responseData?.test_status === 'completed') {
    logger.info(`A/B test '${name}' completed. Using default '${fallback}'.`);
    choiceCache.set(cacheKey, fallback);
    return variants[fallback];
  }

  choiceCache.set(cacheKey, selectedKey);

  if (responseData?.ab_choice_id) {
    const meta = {
      ab_choice_id: responseData.ab_choice_id,
      choice_name: name,
      variant_key: selectedKey,
      variant_value: String(variants[selectedKey]),
    };
    if (!currentSpan.attributes._ab_choices) {
      currentSpan.attributes._ab_choices = [];
    }
    (currentSpan.attributes._ab_choices as unknown[]).push(meta);
  }

  return variants[selectedKey];
}

function weightedRandomChoice(keys: string[], weights: Record<string, number>): string {
  const totalWeight = keys.reduce((sum, k) => sum + (weights[k] || 0), 0);
  let r = Math.random() * totalWeight;
  for (const k of keys) {
    r -= weights[k] || 0;
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

async function sendChoiceData(params: {
  entityType: string;
  entityId: string;
  choiceName: string;
  variantKey: string;
  variantValue: string;
  variants: Record<string, unknown>;
  weights: Record<string, number>;
  durationDays: number;
}): Promise<Record<string, unknown> | null> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const body = {
    entity_type: params.entityType,
    entity_id: params.entityId,
    choice_name: params.choiceName,
    variant_key: params.variantKey,
    variant_value: params.variantValue,
    variants: Object.fromEntries(
      Object.entries(params.variants).map(([k, v]) => [k, String(v)])
    ),
    weights: params.weights,
    duration_days: params.durationDays,
  };

  const res = await fetch(`${apiUrl}/ab-choices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error(`[ZeroEval] ab-choices POST failed: ${res.status} ${text}`);
    return null;
  }

  return res.json();
}
