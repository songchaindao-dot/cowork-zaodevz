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
      '--permission-mode', 'auto',
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
