import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { DomainError } from '../domain/errors.ts';
import type { McpRequestOptions, McpTransport } from '../application/mcp.ts';

export class StdioMcpTransport implements McpTransport {
  private process?: ChildProcessWithoutNullStreams;
  private requestTail: Promise<unknown> = Promise.resolve();
  private readonly command: string;
  private readonly args: string[];
  private readonly allowedCommands: string[];
  private readonly authorize: () => Promise<boolean> | boolean;
  constructor(command: string, args: string[] = [], allowedCommands: string[] = [], authorize: () => Promise<boolean> | boolean = () => false) { this.command = command; this.args = args; this.allowedCommands = allowedCommands; this.authorize = authorize; }
  async request(message: Record<string, unknown>, options: McpRequestOptions = {}): Promise<Record<string, unknown>> {
    const run = this.requestTail.then(() => this.requestOne(message, options));
    this.requestTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async requestOne(message: Record<string, unknown>, options: McpRequestOptions): Promise<Record<string, unknown>> {
    if (options.signal?.aborted) throw new DomainError('cancelled', 'MCP stdio request cancelled');
    await this.start();
    const process = this.process;
    if (!process) throw new DomainError('network', 'MCP stdio process is unavailable');
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const expectedId = message.id;
      const timer = setTimeout(() => finish(new DomainError('network', 'MCP stdio request timed out')), options.timeoutMs ?? 30_000);
      const onAbortSignal = () => finish(new DomainError('cancelled', 'MCP stdio request cancelled'));
      options.signal?.addEventListener('abort', onAbortSignal, { once: true });
      const cleanup = (): void => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbortSignal);
        process.stdout.off('data', onData);
        process.off('error', onError);
        process.off('exit', onExit);
      };
      const finish = (error?: Error, value?: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value!);
      };
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        while (true) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let value: Record<string, unknown>;
          try {
            value = JSON.parse(line) as Record<string, unknown>;
          } catch (error) {
            finish(new DomainError('network', 'Invalid JSON-RPC response', { error: String(error) }));
            return;
          }
          if (expectedId !== undefined && value.id !== expectedId) continue;
          finish(undefined, value);
          return;
        }
      };
      const onError = (error: Error): void => finish(new DomainError('network', 'MCP stdio process failed', { error: error.message }));
      const onExit = (code: number | null): void => finish(new DomainError('network', `MCP stdio process exited before response: ${code ?? 'unknown'}`));
      process.stdout.on('data', onData);
      process.once('error', onError);
      process.once('exit', onExit);
      try {
        process.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        finish(new DomainError('network', 'Unable to write to MCP stdio process', { error: String(error) }));
      }
    });
  }

  async close(): Promise<void> { if (!this.process) return; this.process.kill(); this.process = undefined; }
  private async start(): Promise<void> { if (this.process) return; if (!this.allowedCommands.includes(this.command)) throw new DomainError('security', `MCP command is not allow-listed: ${this.command}`); if (!await this.authorize()) throw new DomainError('unauthorized', 'MCP stdio requires explicit authorization'); this.process = spawn(this.command, this.args, { stdio: 'pipe', windowsHide: true }); this.process.on('exit', () => { this.process = undefined; }); }
}
