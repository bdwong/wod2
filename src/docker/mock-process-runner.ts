import type {
  ProcessResult,
  ProcessRunner,
  RunAsyncOptions,
  RunOptions,
} from "./process-runner.ts";

interface MockResponse {
  commandPrefix: string[];
  result: ProcessResult;
}

export interface RecordedCall {
  command: string[];
  options?: RunOptions | RunAsyncOptions;
  stdinContent?: string;
}

export class MockProcessRunner implements ProcessRunner {
  private responses: MockResponse[] = [];
  private asyncResponses: MockResponse[] = [];
  public calls: string[][] = [];
  public recordedCalls: RecordedCall[] = [];

  addResponse(commandPrefix: string[], result: Partial<ProcessResult>): void {
    this.responses.push({
      commandPrefix,
      result: {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      },
    });
  }

  addAsyncResponse(commandPrefix: string[], result: Partial<ProcessResult>): void {
    this.asyncResponses.push({
      commandPrefix,
      result: {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      },
    });
  }

  run(command: string[], options?: RunOptions): ProcessResult {
    this.calls.push([...command]);
    const recorded: RecordedCall = { command: [...command], options };
    if (options?.stdin != null) {
      recorded.stdinContent =
        typeof options.stdin === "string" ? options.stdin : options.stdin.toString("utf-8");
    }
    this.recordedCalls.push(recorded);
    const match = this.responses.find((r) =>
      r.commandPrefix.every((part, i) => command[i] === part),
    );
    if (match) return match.result;
    return { exitCode: 1, stdout: "", stderr: "no mock response" };
  }

  async runAsync(command: string[], options?: RunAsyncOptions): Promise<ProcessResult> {
    this.calls.push([...command]);
    const recorded: RecordedCall = { command: [...command], options };
    if (options?.stdin) {
      try {
        recorded.stdinContent = await new Response(options.stdin).text();
      } catch {
        recorded.stdinContent = "<stream error>";
      }
    }
    this.recordedCalls.push(recorded);
    const match = this.asyncResponses.find((r) =>
      r.commandPrefix.every((part, i) => command[i] === part),
    );
    if (match) return match.result;
    return { exitCode: 1, stdout: "", stderr: "no mock async response" };
  }
}
