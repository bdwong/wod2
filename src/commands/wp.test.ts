import { describe, expect, test } from "bun:test";
import { MockProcessRunner } from "../docker/mock-process-runner.ts";
import { buildWpCommand, type WpDependencies } from "./wp.ts";

function createDeps(overrides?: Partial<WpDependencies>): WpDependencies {
  return {
    processRunner: overrides?.processRunner ?? new MockProcessRunner(),
    isTTY: overrides?.isTTY ?? false,
  };
}

describe("buildWpCommand", () => {
  describe("container lookup", () => {
    test("returns error when no running container found", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      const deps = createDeps({ processRunner: runner });
      const result = buildWpCommand(deps, "mysite", ["plugin", "list"]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("No running WordPress container found");
      expect(result.dockerCommand).toBeNull();
    });

    test("finds container with standard name", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      const deps = createDeps({ processRunner: runner });
      const result = buildWpCommand(deps, "mysite", ["plugin", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.dockerCommand).toContain("abc123");
    });

    test("falls back to hyphen-stripped name", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=my-site-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "def456\n",
      });
      runner.addResponse(["docker", "exec", "def456", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      const deps = createDeps({ processRunner: runner });
      const result = buildWpCommand(deps, "my-site", ["plugin", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.dockerCommand).toContain("def456");
    });

    test("does not try fallback when name has no hyphens", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "",
      });
      const deps = createDeps({ processRunner: runner });
      const result = buildWpCommand(deps, "mysite", ["plugin", "list"]);
      expect(result.exitCode).toBe(1);
      // Should only have the one container ls call, no fallback
      expect(runner.calls).toHaveLength(1);
    });
  });

  describe("environment variables", () => {
    test("passes WORDPRESS env vars to wp-cli container", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\nWORDPRESS_DB_USER=wp\nHOME=/root\nPATH=/usr/bin\n",
      });
      const deps = createDeps({ processRunner: runner });
      const result = buildWpCommand(deps, "mysite", ["option", "get", "siteurl"]);
      expect(result.dockerCommand).not.toBeNull();
      const cmd = result.dockerCommand as string[];
      expect(cmd).toContain("--env");
      expect(cmd).toContain("WORDPRESS_DB_HOST=db:3306");
      // Extracted value overrides baseline
      expect(cmd).toContain("WORDPRESS_DB_USER=wp");
      // Baseline vars are always included
      expect(cmd).toContain("WORDPRESS_DB_PASSWORD=wordpress");
      expect(cmd).toContain("WORDPRESS_DB_NAME=wordpress");
      // Non-WORDPRESS vars should not be included
      expect(cmd).not.toContain("HOME=/root");
      expect(cmd).not.toContain("PATH=/usr/bin");
    });
  });

  describe("TTY handling", () => {
    test("uses -it flags when stdin is a TTY", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      const deps = createDeps({ processRunner: runner, isTTY: true });
      const result = buildWpCommand(deps, "mysite", ["shell"]);
      expect(result.dockerCommand).toContain("-it");
      expect(result.dockerCommand).not.toContain("-i");
    });

    test("uses -i flag when stdin is not a TTY", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      const deps = createDeps({ processRunner: runner, isTTY: false });
      const result = buildWpCommand(deps, "mysite", ["plugin", "list"]);
      expect(result.dockerCommand).toContain("-i");
      expect(result.dockerCommand).not.toContain("-it");
    });
  });

  describe("docker command structure", () => {
    test("builds correct docker run command with all flags", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      const deps = createDeps({ processRunner: runner, isTTY: false });
      const result = buildWpCommand(deps, "mysite", ["plugin", "list", "--status=active"]);
      expect(result.dockerCommand).not.toBeNull();
      const cmd = result.dockerCommand as string[];

      expect(cmd[0]).toBe("docker");
      expect(cmd[1]).toBe("run");
      expect(cmd).toContain("--rm");
      expect(cmd).toContain("--volumes-from");
      expect(cmd).toContain("abc123");
      expect(cmd).toContain("--network");
      expect(cmd).toContain("container:abc123");
      expect(cmd).toContain("--user");
      expect(cmd).toContain("33:33");
      expect(cmd).toContain("wordpress:cli");
      expect(cmd).toContain("wp");
      // wp-cli args at the end
      const wpIdx = cmd.indexOf("wp");
      expect(cmd.slice(wpIdx + 1)).toEqual(["plugin", "list", "--status=active"]);
    });

    test("passes all wp-cli arguments through", () => {
      const runner = new MockProcessRunner();
      runner.addResponse(["docker", "container", "ls", "-qf", "name=mysite-wordpress-"], {
        exitCode: 0,
        stdout: "abc123\n",
      });
      runner.addResponse(["docker", "exec", "abc123", "env"], {
        exitCode: 0,
        stdout: "WORDPRESS_DB_HOST=db:3306\n",
      });
      const deps = createDeps({ processRunner: runner });
      const result = buildWpCommand(deps, "mysite", ["db", "export", "-"]);
      expect(result.dockerCommand).not.toBeNull();
      const cmd = result.dockerCommand as string[];
      const wpIdx = cmd.indexOf("wp");
      expect(cmd.slice(wpIdx + 1)).toEqual(["db", "export", "-"]);
    });
  });
});
