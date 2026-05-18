// Spawn local claude CLI subprocess. Uses whatever auth the CLI has (Max plan
// OAuth via `claude /login`). Costs $0 marginal. Default provider for the bot.

import { spawn } from 'node:child_process';
import { llmError, type LLMRequest } from './types';

export async function callClaudeMax(req: LLMRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--model', req.model,
      '--print',
      '--append-system-prompt', req.system,
      // v2.13 - was 'auto'. With no interactive operator, 'auto' surfaces
      // permission prompts that time out, then the model narrates about them
      // ("approve in the system dialog..."). 'dontAsk' auto-denies any tool
      // not pre-approved, so there's no prompt event to narrate about.
      '--permission-mode', 'dontAsk',
      // v2.13 - bot is a chat-only concierge. It has zero use for Read/Edit/
      // Write/Bash/etc. Removing them from the subprocess removes the surface
      // the model was hallucinating about ("I need write permission to
      // create data/actions.json"). Doc 671 fix 1c.
      '--disallowedTools',
      'Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit',
    ];
    const proc = spawn('claude', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(llmError('claude-max', req.model, `exit ${code}: ${stderr.slice(0, 300)}`));
      }
      resolve(stdout.trim());
    });
    proc.stdin.write(`${req.user}\n`);
    proc.stdin.end();
  });
}
