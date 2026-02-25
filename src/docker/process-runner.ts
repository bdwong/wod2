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
    const proc = Bun.spawn(command, {
      cwd: options?.cwd,
      stdin: options?.stdin ?? undefined,
      stdout: "pipe",
      stderr: this.verbose ? "inherit" : "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = this.verbose ? "" : await new Response(proc.stderr).text();
    if (this.verbose && stdout) {
      console.error(stdout);
    }
    return { exitCode, stdout, stderr };
  }
}
