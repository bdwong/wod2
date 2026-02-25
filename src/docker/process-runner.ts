export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(command: string[], options?: { cwd?: string }): ProcessResult;
}

export class BunProcessRunner implements ProcessRunner {
  private verbose: boolean;

  constructor(options?: { verbose?: boolean }) {
    this.verbose = options?.verbose ?? false;
  }

  run(command: string[], options?: { cwd?: string }): ProcessResult {
    if (this.verbose) {
      console.error(`$ ${command.join(" ")}`);
    }
    const proc = Bun.spawnSync(command, {
      cwd: options?.cwd,
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
}
