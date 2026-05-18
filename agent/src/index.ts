// ZAOcoworkingBot v2.5 entry.
// Hermes pattern: grammy polls Telegram, each allowed message spawns the user's
// configured LLM (claude-max/claude-api/openai/minimax) with appendSystemPrompt
// = 5-block Letta memory + actions snapshot. Default provider = claude-max
// (local CLI, Max OAuth, $0 marginal cost).
//
// Slash commands:
//   Action tracker: /start /mine /list /add /wip /blocked /done /assign /daily
//   Model/key:      /setmodel /mymodel /setkey /clearkey /providers
//
// Action mutations write to data/actions.json via Octokit Contents API
// (SHA dance). Suggest-then-confirm flow for conversational extraction.

import { config as loadEnv } from 'dotenv';
loadEnv();

import { Bot, Context } from 'grammy';
import {
  cmdAdd,
  cmdAssign,
  cmdBlocked,
  cmdDaily,
  cmdDone,
  cmdList,
  cmdMine,
  cmdStart,
  cmdWip,
} from './commands';
import {
  maybeHandleConfirmation,
  maybeStartSuggestionFlow,
} from './extraction';
import { callLLM } from './llm';
import {
  buildMemoryBlocks,
  ensureCoworkHome,
  memoryBlocksToSystemPrompt,
} from './memory';
import { logMessage } from './transcripts';
import {
  cmdClearKey,
  cmdMyModel,
  cmdProviders,
  cmdSetKey,
  cmdSetModel,
} from './user-commands';
import { cmdAddChat, cmdAddUser, cmdReload, cmdTeam } from './roster-commands';
import { rosterView } from './roster';
import { resolveLLMForUser } from './users';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const bot = new Bot(token);

await ensureCoworkHome();

// Roster is loaded from data/team.json in repo via Octokit + cached locally.
// ENV ALLOWLIST_USER_IDS / ALLOWLIST_CHAT_IDS are now FALLBACK ONLY (cold start
// without GITHUB_TOKEN). Adding a user = /adduser <tg_id> <Name> from admin DM,
// commits to repo, hot-reloads. NO restart needed.
const bootRoster = await rosterView();
if (bootRoster.allowedUserIds.size === 0) {
  console.error('roster empty - no users allowed. set ALLOWLIST_USER_IDS as fallback or push data/team.json');
  process.exit(1);
}
console.log(`[zaocoworking] roster loaded: ${bootRoster.memberCount} members, ${bootRoster.chatCount} chats`);

function chatScopeOf(ctx: Context): string {
  return ctx.chat?.type === 'private' ? 'private' : String(ctx.chat?.id ?? 'unknown');
}

async function isAllowedSender(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  const view = await rosterView();
  if (!view.allowedUserIds.has(userId)) return false;
  if (ctx.chat?.type === 'private') return true;
  // Group: chat must be allowlisted AND message must @mention the bot
  if (!ctx.chat?.id || !view.allowedChatIds.has(ctx.chat.id)) return false;
  const text = ctx.message?.text ?? '';
  const me = bot.botInfo?.username ?? '';
  return me ? text.includes(`@${me}`) : false;
}

function senderLabel(ctx: Context): string {
  return ctx.from?.first_name ?? ctx.from?.username ?? `user:${ctx.from?.id ?? '?'}`;
}

// LLM dispatch moved to ./llm — callLLM({provider, model, system, user, apiKey}).
// Per-user provider/model/key resolved via resolveLLMForUser() from ./users.

async function logIncoming(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  await logMessage({
    chat_id: String(chatId),
    chat_type: ctx.chat?.type === 'private' ? 'dm' : 'group',
    chat_title: ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined,
    from_user_id: ctx.from?.id ?? 0,
    from_user_name: senderLabel(ctx),
    direction: 'in',
    message_text: text,
    reply_to_id: ctx.message?.reply_to_message?.message_id,
  });
}

async function logOutgoing(ctx: Context, text: string, latencyMs: number, model: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  await logMessage({
    chat_id: String(chatId),
    chat_type: ctx.chat?.type === 'private' ? 'dm' : 'group',
    chat_title: ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined,
    from_user_id: 0,
    from_user_name: 'ZAOcoworkingBot',
    direction: 'out',
    message_text: text,
    bot_model: model,
    response_latency_ms: latencyMs,
  });
}

async function withErrorReply(ctx: Context, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error('[zaocoworking] handler failed:', (err as Error).message);
    await ctx.reply(`error: ${(err as Error).message.slice(0, 200)}`).catch(() => {});
  }
}

bot.command('start', async (ctx) => {
  if (!(await isAllowedSender(ctx))) return;
  await withErrorReply(ctx, () => cmdStart(ctx));
});

function withArgs(handler: (ctx: Context, args: string) => Promise<void>): (ctx: Context) => Promise<void> {
  return async (ctx: Context) => {
    if (!(await isAllowedSender(ctx))) return;
    const text = ctx.message?.text ?? '';
    const args = text.replace(/^\/\w+(@\S+)?\s*/, '');
    await withErrorReply(ctx, () => handler(ctx, args));
  };
}

bot.command('mine', withArgs((ctx) => cmdMine(ctx)));
bot.command('list', withArgs(cmdList));
bot.command('add', withArgs(cmdAdd));
bot.command('wip', withArgs(cmdWip));
bot.command('blocked', withArgs(cmdBlocked));
bot.command('done', withArgs(cmdDone));
bot.command('assign', withArgs(cmdAssign));
bot.command('daily', withArgs((ctx) => cmdDaily(ctx)));

// v2.5 - model selection + BYOK
bot.command('setmodel', withArgs(cmdSetModel));
bot.command('mymodel', withArgs((ctx) => cmdMyModel(ctx)));
bot.command('setkey', withArgs(cmdSetKey));
bot.command('clearkey', withArgs(cmdClearKey));
bot.command('providers', withArgs((ctx) => cmdProviders(ctx)));

// v2.6 - team roster (no-restart member management)
bot.command('team', withArgs((ctx) => cmdTeam(ctx)));
bot.command('adduser', withArgs(cmdAddUser));
bot.command('addchat', withArgs((ctx) => cmdAddChat(ctx)));
bot.command('reload', withArgs((ctx) => cmdReload(ctx)));

bot.on('message:text', async (ctx) => {
  const text = ctx.message?.text ?? '';
  if (text.startsWith('/')) return; // already handled
  if (!(await isAllowedSender(ctx))) {
    console.log(`[zaocoworking] drop from ${ctx.from?.id} (${ctx.from?.username ?? '?'}) chat=${ctx.chat?.id}`);
    return;
  }
  await logIncoming(ctx, text);

  // Confirmation path - if pending suggestion exists for this chat+user, treat
  // this message as the y/n response.
  if (await maybeHandleConfirmation(ctx, text)) return;

  const scope = chatScopeOf(ctx);
  const blocks = await buildMemoryBlocks(scope);
  const systemPrompt = memoryBlocksToSystemPrompt(blocks, scope);
  const llm = await resolveLLMForUser(ctx.from?.id ?? 0);
  const started = Date.now();
  await ctx.replyWithChatAction('typing').catch(() => {});
  try {
    const raw = await callLLM({
      provider: llm.provider,
      model: llm.model,
      system: systemPrompt,
      user: `${senderLabel(ctx)}: ${text}`,
      apiKey: llm.apiKey,
    });
    const final = await maybeStartSuggestionFlow(ctx, raw);
    const latency = Date.now() - started;
    if (!final) {
      await ctx.reply('(empty reply - check logs)');
      return;
    }
    await ctx.reply(final);
    await logOutgoing(ctx, final, latency, `${llm.provider}/${llm.model}`);
  } catch (err) {
    console.error('[zaocoworking] llm failed:', (err as Error).message);
    await ctx.reply(`error: ${(err as Error).message.slice(0, 200)}`);
  }
});

await bot.start({
  onStart: (info) => console.log(`[zaocoworking] online as @${info.username}`),
});
