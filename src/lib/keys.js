import { customAlphabet } from 'nanoid';
import crypto from 'node:crypto';

// Base62-ish alphabet, no ambiguous characters. 40 chars ~= 238 bits of entropy.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const nanoid = customAlphabet(alphabet, 40);

/**
 * Generates a new raw API key. This value is shown to the user exactly once
 * and is never stored anywhere -- only its hash is persisted.
 * Format: sk_live_<random>  (mirrors the convention used by Stripe/OpenAI etc.)
 */
export function generateApiKey(env = 'live') {
  const raw = `sk_${env}_${nanoid()}`;
  return raw;
}

/** Deterministic hash used for storage + lookup. Never store the raw key. */
export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/** Short, safe-to-display fragment for dashboards ("sk_live_ab12..."). */
export function keyPrefix(rawKey) {
  return rawKey.slice(0, 12);
}

/** Constant-time-ish check used only for comparing prefixes in logs/UI, not for auth. */
export function maskKey(rawKey) {
  return `${keyPrefix(rawKey)}${'*'.repeat(Math.max(rawKey.length - 12, 4))}`;
}
