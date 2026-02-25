export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  stdin?: string | Buffer;
}

export interface RunAsyncOptions {
  cwd?: string;
  stdin?: ReadableStream;
}

export interface ProcessRunner {
  run(command: string[], options?: RunOptions): ProcessResult;
  runAsync(command: string[], options?: RunAsyncOptions): Promise<ProcessResult>;
}

export class BunProcessRunner implements ProcessRunner {
  private verbose: boolean;

  constructor(options?: { verbose?: boolean }) {
    this.verbose = options?.verbose ?? false;
  }

  run(command: string[], options?: RunOptions): ProcessResult {
    if (this.verbose) {
      console.error(`$ ${command.join(" ")}`);
    }
    const proc = Bun.spawnSync(command, {
      cwd: options?.cwd,
      stdin: options?.stdin != null ? new Blob([options.stdin]) : undefined,
      stdout: "pipe",
      stderr: this.verbose ? "inherit" : "pipe",
    });
    const stdout = proc.stdout.toString();
    if (this.verbose && stdout) {
      console.error(stdout);
    }
    return {
      exitCode: proc.exitCode,
      stdout,
      stderr: this.verbose ? "" : proc.stderr.toString(),
    };
  }

  async runAsync(command: string[], options?: RunAsyncOptions): Promise<ProcessResult> {
    if (this.verbose) {
      console.error(`$ ${command.join(" ")}`);
    }
    // Use "pipe" for stdin instead of passing ReadableStream directly,
    // because Bun's compiled single-file executables don't support
    // ReadableStream as stdin (TODOError). Workaround added 2026-02-25.
    const proc = Bun.spawn(command, {
      cwd: options?.cwd,
      stdin: options?.stdin ? "pipe" : undefined,
      stdout: "pipe",
      stderr: this.verbose ? "inherit" : "pipe",
    });
    if (options?.stdin) {
      const reader = options.stdin.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          proc.stdin?.write(value);
        }
      } finally {
        reader.releaseLock();
        proc.stdin?.end();
      }
    }
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = this.verbose ? "" : await new Response(proc.stderr).text();
    if (this.verbose && stdout) {
      console.error(stdout);
    }
    return { exitCode, stdout, stderr };
  }
}
