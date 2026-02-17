import { Command } from "commander";
import { listInstances } from "../commands/ls.ts";
import { formatLsOutput } from "../commands/ls-formatter.ts";
import { resolveConfig } from "../config/config.ts";
import { BunProcessRunner } from "../docker/process-runner.ts";
import { RealFilesystem } from "../utils/filesystem.ts";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("wod")
    .description("WordPress on Docker — manage disposable WordPress instances")
    .version("0.1.0");

  program
    .command("ls")
    .description("List all instances with status")
    .action(() => {
      const config = resolveConfig();
      const result = listInstances({
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
      });
      const output = formatLsOutput(result);
      console.log(output);
    });

  return program;
}
