import { describe, expect, test } from "bun:test";
import { createProgram, validateInstanceName } from "./cli.ts";

describe("createProgram", () => {
  test("returns a Commander program", () => {
    const program = createProgram();
    expect(program.name()).toBe("wod");
  });

  test("has an ls subcommand", () => {
    const program = createProgram();
    const lsCommand = program.commands.find((cmd) => cmd.name() === "ls");
    expect(lsCommand).toBeDefined();
  });

  test("ls subcommand has a description", () => {
    const program = createProgram();
    const lsCommand = program.commands.find((cmd) => cmd.name() === "ls");
    expect(lsCommand?.description()).toBeTruthy();
  });

  test("has a create subcommand", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    expect(createCommand).toBeDefined();
    expect(createCommand?.description()).toBeTruthy();
  });

  test("create subcommand has --php-version option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--php-version");
    expect(option).toBeDefined();
  });

  test("create subcommand has --wordpress-version option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--wordpress-version");
    expect(option).toBeDefined();
  });

  test("create subcommand has --template option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--template");
    expect(option).toBeDefined();
  });

  test("create subcommand has --hostnames option", () => {
    const program = createProgram();
    const createCommand = program.commands.find((cmd) => cmd.name() === "create");
    const option = createCommand?.options.find((opt) => opt.long === "--hostnames");
    expect(option).toBeDefined();
  });

  test("update subcommand has --hostnames option", () => {
    const program = createProgram();
    const updateCommand = program.commands.find((cmd) => cmd.name() === "update");
    const option = updateCommand?.options.find((opt) => opt.long === "--hostnames");
    expect(option).toBeDefined();
  });
});

describe("validateInstanceName", () => {
  test("accepts simple names", () => {
    expect(validateInstanceName("mysite")).toBeNull();
    expect(validateInstanceName("my-site")).toBeNull();
    expect(validateInstanceName("site123")).toBeNull();
  });

  test("rejects names with forward slashes", () => {
    const result = validateInstanceName("/mnt/e/backups/websites/btmcan.org/");
    expect(result).toContain("must not contain slashes");
    expect(result).toContain("Did you forget the instance name argument?");
  });

  test("rejects names with backslashes", () => {
    const result = validateInstanceName("C:\\Users\\backups");
    expect(result).toContain("must not contain slashes");
  });

  test("rejects names starting with a dot", () => {
    const result = validateInstanceName(".hidden");
    expect(result).toContain("must not start with a dot");
  });
});
