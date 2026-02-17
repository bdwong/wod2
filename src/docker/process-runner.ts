export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(command: string[], options?: { cwd?: string }): ProcessResult;
}

export class BunProcessRunner implements ProcessRunner {
  run(command: string[], options?: { cwd?: string }): ProcessResult {
    const proc = Bun.spawnSync(command, {
      cwd: options?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  }
}
