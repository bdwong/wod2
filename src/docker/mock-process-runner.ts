import type { ProcessResult, ProcessRunner } from "./process-runner.ts";

interface MockResponse {
  commandPrefix: string[];
  result: ProcessResult;
}

export class MockProcessRunner implements ProcessRunner {
  private responses: MockResponse[] = [];
  public calls: string[][] = [];

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

  run(command: string[]): ProcessResult {
    this.calls.push([...command]);
    const match = this.responses.find((r) =>
      r.commandPrefix.every((part, i) => command[i] === part),
    );
    if (match) return match.result;
    return { exitCode: 1, stdout: "", stderr: "no mock response" };
  }
}
