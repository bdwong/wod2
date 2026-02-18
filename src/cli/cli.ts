import { Command } from "commander";
import { createInstance } from "../commands/create.ts";
import { downInstance } from "../commands/down.ts";
import { listInstances } from "../commands/ls.ts";
import { formatLsOutput } from "../commands/ls-formatter.ts";
import { upInstance } from "../commands/up.ts";
import { resolveConfig } from "../config/config.ts";
import { resolveCreateConfig } from "../config/create-config.ts";
import { BunProcessRunner } from "../docker/process-runner.ts";
import { RealFilesystem } from "../utils/filesystem.ts";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("wod")
    .description("WordPress on Docker — manage disposable WordPress instances")
    .version("0.1.0");

  program
    .command("create")
    .description("Create a new WordPress Docker instance")
    .argument("<name>", "Instance name")
    .action(async (name: string) => {
      const config = resolveConfig();
      const createConfig = resolveCreateConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
        createConfig,
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      };
      const result = await createInstance(deps, name);
      if (result.error) {
        console.error(result.error);
      }
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      if (result.adminPassword) {
        console.log(`Admin password: ${result.adminPassword}`);
      }
      if (result.siteUrl) {
        console.log(`Website ready at ${result.siteUrl}`);
      }
    });

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

  program
    .command("up")
    .description("Start a stopped WordPress instance")
    .argument("<name>", "Instance name")
    .action((name: string) => {
      const config = resolveConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
      };
      const result = upInstance(deps, name);
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      if (result.siteUrl) {
        console.log(`Website ready at ${result.siteUrl}`);
      }
    });

  program
    .command("down")
    .description("Stop a running WordPress instance")
    .argument("<name>", "Instance name")
    .action((name: string) => {
      const config = resolveConfig();
      const deps = {
        processRunner: new BunProcessRunner(),
        filesystem: new RealFilesystem(),
        config,
      };
      const result = downInstance(deps, name);
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });

  return program;
}
