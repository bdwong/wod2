import { describe, expect, test } from "bun:test";
import { containerIsRunning, dockerIsRunning, querySiteUrl } from "./docker.ts";
import { MockProcessRunner } from "./mock-process-runner.ts";

describe("dockerIsRunning", () => {
  test("returns true when docker version exits 0", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "version"], { exitCode: 0 });
    expect(dockerIsRunning(runner)).toBe(true);
  });

  test("returns false when docker version exits non-zero", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "version"], { exitCode: 1, stderr: "Cannot connect" });
    expect(dockerIsRunning(runner)).toBe(false);
  });
});

describe("containerIsRunning", () => {
  test("returns true when container ls returns an ID", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "abc123def456\n",
    });
    expect(containerIsRunning(runner, "mysite", "db")).toBe(true);
  });

  test("returns false when container ls returns empty output", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "",
    });
    expect(containerIsRunning(runner, "mysite", "db")).toBe(false);
  });

  test("returns false when docker command fails", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 1,
    });
    expect(containerIsRunning(runner, "mysite", "wordpress")).toBe(false);
  });

  test("passes correct filter for instance name and service", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "",
    });
    containerIsRunning(runner, "staging-b", "wordpress");
    expect(runner.calls[0]).toEqual([
      "docker",
      "container",
      "ls",
      "-qf",
      "name=staging-b-wordpress-",
    ]);
  });
});

describe("querySiteUrl", () => {
  test("returns site URL when all commands succeed", () => {
    const runner = new MockProcessRunner();
    // Container lookup
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "abc123\n",
    });
    // Env extraction
    runner.addResponse(["docker", "exec"], {
      exitCode: 0,
      stdout: "WORDPRESS_DB_HOST=db:3306\nWORDPRESS_DB_USER=wordpress\nHOME=/root\n",
    });
    // wp-cli siteurl query
    runner.addResponse(["docker", "run"], {
      exitCode: 0,
      stdout: "http://127.0.0.1:8000\n",
    });
    expect(querySiteUrl(runner, "mysite")).toBe("http://127.0.0.1:8000");
  });

  test("returns null when no container is found", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "",
    });
    expect(querySiteUrl(runner, "mysite")).toBeNull();
  });

  test("returns null when wp-cli command fails", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-qf"], {
      exitCode: 0,
      stdout: "abc123\n",
    });
    runner.addResponse(["docker", "exec"], {
      exitCode: 0,
      stdout: "WORDPRESS_DB_HOST=db:3306\n",
    });
    runner.addResponse(["docker", "run"], {
      exitCode: 1,
      stderr: "Error",
    });
    expect(querySiteUrl(runner, "mysite")).toBeNull();
  });
});
