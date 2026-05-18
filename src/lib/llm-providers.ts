// v2.9 web app multi-provider adapter (mirrors agent/src/llm structure).
// Three streaming providers for the /chat tab:
//   - minimax    (Iman's original, M2.7 with <think> strip)
//   - openai     (gpt-4o-mini default, OpenAI-compatible SSE - same parser as minimax)
//   - claude     (Anthropic Messages API, different SSE format)
//
// Per-user BYOK keys are sent client-side via "x-byok-key" header; server uses
// that if present, otherwise falls back to env. Future: per-user keys in
// Supabase user_settings table (Iman BACKLOG Phase 2).

export type Provider = 'minimax' | 'openai' | 'claude';

export const PROVIDERS: readonly Provider[] = ['minimax', 'openai', 'claude'];

export interface ProviderConfig {
  defaultModel: string;
  envKey: string; // env var name for fallback API key
}

export const PROVIDER_CONFIG: Record<Provider, ProviderConfig> = {
  minimax: {
    defaultModel: process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
    envKey: 'MINIMAX_API_KEY',
  },
  openai: {
    defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
  },
  claude: {
    defaultModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    envKey: 'ANTHROPIC_API_KEY',
  },
};

export function isProvider(s: unknown): s is Provider {
  return typeof s === 'string' && (PROVIDERS as readonly string[]).includes(s);
}

export function resolveApiKey(provider: Provider, byok: string | null | undefined): string | null {
  if (byok && byok.trim()) return byok.trim();
  const envName = PROVIDER_CONFIG[provider].envKey;
  return process.env[envName] || null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  provider: Provider;
  model: string;
  apiKey: string;
  systemPrompt: string;
  history: ChatTurn[];
}

export interface ProviderStreamResult {
  upstream: Response;
  parser: (buffer: string) => { textDelta: string; remainder: string; done: boolean };
}

const MINIMAX_URL = process.env.MINIMAX_API_URL || 'https://api.minimax.io/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Fire the upstream POST and return a stream + provider-specific SSE parser. */
export async function callProvider(req: ProviderRequest): Promise<Response> {
  switch (req.provider) {
    case 'minimax':
      return fetch(MINIMAX_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: req.model,
          stream: true,
          max_tokens: 2048,
          messages: [{ role: 'system', content: req.systemPrompt }, ...req.history],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    case 'openai':
      return fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: req.model,
          stream: true,
          messages: [{ role: 'system', content: req.systemPrompt }, ...req.history],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    case 'claude':
      return fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': req.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: req.model,
          stream: true,
          max_tokens: 2048,
          system: req.systemPrompt,
          messages: req.history,
        }),
        signal: AbortSignal.timeout(60_000),
      });
  }
}

/**
 * Stateful SSE-line parser that extracts text deltas for the given provider.
 * Both OpenAI + MiniMax use the same OpenAI SSE format; Claude is different.
 */
export type DeltaExtractor = (line: string) => string;

export function deltaExtractorFor(provider: Provider): DeltaExtractor {
  switch (provider) {
    case 'minimax':
    case 'openai':
      return (line: string) => {
        if (!line.startsWith('data:')) return '';
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return '';
        try {
          const j = JSON.parse(payload);
          return (
            j?.choices?.[0]?.delta?.content ??
            j?.choices?.[0]?.message?.content ??
            ''
          );
        } catch {
          return '';
        }
      };
    case 'claude':
      return (line: string) => {
        if (!line.startsWith('data:')) return '';
        const payload = line.slice(5).trim();
        if (!payload) return '';
        try {
          const j = JSON.parse(payload);
          if (j?.type === 'content_block_delta' && j?.delta?.type === 'text_delta') {
            return j.delta.text ?? '';
          }
          return '';
        } catch {
          return '';
        }
      };
  }
}
