// Slash commands for v2.5 - model selection + BYOK.
// /setmodel <provider> <model>     - set my preferred provider + model
// /setkey <provider> <key>         - DM-only; set my BYOK
// /clearkey <provider>             - remove my BYOK for a provider
// /mymodel                         - show my current resolved provider/model/source
// /providers                       - list available providers + how to set keys

import { Context } from 'grammy';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from './llm';
import {
  clearUserApiKey,
  isAutoConfirm,
  isValidProvider,
  loadUserPrefs,
  resolveLLMForUser,
  setAutoConfirm,
  setUserApiKey,
  setUserModel,
} from './users';

function tgId(ctx: Context): number | null {
  return ctx.from?.id ?? null;
}

export async function cmdSetModel(ctx: Context, args: string): Promise<void> {
  const id = tgId(ctx);
  if (!id) return;
  const m = args.trim().match(/^(\S+)\s+(\S+)$/);
  if (!m) {
    await ctx.reply(
      `usage: /setmodel <provider> <model>\nproviders: ${PROVIDERS.join(', ')}\nexamples:\n  /setmodel claude-max sonnet\n  /setmodel claude-api claude-haiku-4-5-20251001\n  /setmodel openai gpt-4o-mini\n  /setmodel minimax abab6.5-chat`,
    );
    return;
  }
  const [, provider, model] = m;
  if (!isValidProvider(provider)) {
    await ctx.reply(`unknown provider "${provider}". valid: ${PROVIDERS.join(', ')}`);
    return;
  }
  await setUserModel(id, provider, model);
  await ctx.reply(`saved: ${provider} / ${model}`);
}

export async function cmdMyModel(ctx: Context): Promise<void> {
  const id = tgId(ctx);
  if (!id) return;
  const resolved = await resolveLLMForUser(id);
  const hasKey = !!resolved.apiKey;
  await ctx.reply(
    `provider: ${resolved.provider}\nmodel: ${resolved.model}\nsource: ${resolved.source}\napi key: ${hasKey ? 'set (per-user)' : 'env default'}`,
  );
}

export async function cmdSetKey(ctx: Context, args: string): Promise<void> {
  const id = tgId(ctx);
  if (!id) return;
  // DM only - never accept secrets in groups
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('DM me /setkey - do not paste keys in a group chat. message will be ignored.');
    return;
  }
  const m = args.trim().match(/^(\S+)\s+(\S+)$/);
  if (!m) {
    await ctx.reply(
      `usage (DM only): /setkey <provider> <key>\nproviders: ${PROVIDERS.filter((p) => p !== 'claude-max').join(', ')}\nclaude-max uses local OAuth - no key needed.`,
    );
    return;
  }
  const [, provider, key] = m;
  if (!isValidProvider(provider)) {
    await ctx.reply(`unknown provider "${provider}". valid: ${PROVIDERS.join(', ')}`);
    return;
  }
  if (provider === 'claude-max') {
    await ctx.reply('claude-max uses local CLI OAuth - no per-user key needed. ignored.');
    return;
  }
  await setUserApiKey(id, provider, key);
  // Best-effort: delete the user's message containing the key so it doesn't sit in Telegram history
  try {
    if (ctx.message?.message_id) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    }
  } catch {
    /* ignore - bot may lack delete perms */
  }
  await ctx.reply(`saved ${provider} key (your message was deleted from chat history)`);
}

export async function cmdClearKey(ctx: Context, args: string): Promise<void> {
  const id = tgId(ctx);
  if (!id) return;
  const provider = args.trim();
  if (!isValidProvider(provider)) {
    await ctx.reply(`usage: /clearkey <provider>. valid: ${PROVIDERS.join(', ')}`);
    return;
  }
  await clearUserApiKey(id, provider);
  await ctx.reply(`cleared ${provider} key. falls back to env default.`);
}

// v2.11 - autoconfirm. When ON, natural-language mutations write immediately
// instead of asking "reply yes to confirm". Slash commands always write
// directly regardless of this setting.
export async function cmdAutoConfirm(ctx: Context, args: string): Promise<void> {
  const id = tgId(ctx);
  if (!id) return;
  const arg = args.trim().toLowerCase();
  if (arg === '') {
    const current = await isAutoConfirm(id);
    await ctx.reply(
      `autoconfirm: ${current ? 'ON' : 'OFF'}\n\nWhen ON: natural-language requests like "set #24 due date to 2026-05-28" run immediately.\nWhen OFF (default): bot suggests + asks "yes" to confirm.\nSlash commands (/setdue, /done, etc) always run directly either way.\n\nusage: /autoconfirm on | off`,
    );
    return;
  }
  if (arg !== 'on' && arg !== 'off') {
    await ctx.reply('usage: /autoconfirm on | off');
    return;
  }
  await setAutoConfirm(id, arg === 'on');
  await ctx.reply(
    arg === 'on'
      ? 'autoconfirm ON. natural-language edits run immediately. use /autoconfirm off to undo.'
      : 'autoconfirm OFF. natural-language edits will ask "yes" to confirm first.',
  );
}

export async function cmdProviders(ctx: Context): Promise<void> {
  const id = tgId(ctx);
  const prefs = id ? await loadUserPrefs(id) : null;
  const hasKey = (p: string) => !!prefs?.api_keys?.[p as never];
  const lines = PROVIDERS.map((p) => {
    const tag = p === 'claude-max' ? '(local OAuth, $0)' : hasKey(p) ? '(your key)' : '(env default if set)';
    return `  ${p} ${tag}`;
  });
  await ctx.reply(
    `providers:\n${lines.join('\n')}\n\ndefault: ${DEFAULT_PROVIDER} / ${DEFAULT_MODEL}\n\n/setmodel <provider> <model> - choose\n/setkey <provider> <key> - DM only, BYOK\n/clearkey <provider> - drop BYOK\n/mymodel - show current resolved settings`,
  );
}
