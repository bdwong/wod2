import { describe, expect, test } from "bun:test";
import {
  containerExists,
  containerIsRunning,
  dockerIsRunning,
  getWordPressEnvVars,
  querySiteUrl,
  volumeExists,
} from "./docker.ts";
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

describe("containerExists", () => {
  test("returns true when container ls -a returns an ID", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-aqf"], {
      exitCode: 0,
      stdout: "abc123def456\n",
    });
    expect(containerExists(runner, "mysite", "db")).toBe(true);
  });

  test("returns false when container ls -a returns empty output", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-aqf"], {
      exitCode: 0,
      stdout: "",
    });
    expect(containerExists(runner, "mysite", "db")).toBe(false);
  });

  test("returns false when docker command fails", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-aqf"], {
      exitCode: 1,
    });
    expect(containerExists(runner, "mysite", "wordpress")).toBe(false);
  });

  test("passes correct filter with -a flag", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "container", "ls", "-aqf"], {
      exitCode: 0,
      stdout: "",
    });
    containerExists(runner, "staging-b", "wordpress");
    expect(runner.calls[0]).toEqual([
      "docker",
      "container",
      "ls",
      "-aqf",
      "name=staging-b-wordpress-",
    ]);
  });
});

describe("volumeExists", () => {
  test("returns true when volume ls returns a name", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "volume", "ls", "-qf"], {
      exitCode: 0,
      stdout: "mysite_db_data\n",
    });
    expect(volumeExists(runner, "mysite_db_data")).toBe(true);
  });

  test("returns false when volume ls returns empty output", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "volume", "ls", "-qf"], {
      exitCode: 0,
      stdout: "",
    });
    expect(volumeExists(runner, "mysite_db_data")).toBe(false);
  });

  test("returns false when docker command fails", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "volume", "ls", "-qf"], {
      exitCode: 1,
    });
    expect(volumeExists(runner, "mysite_db_data")).toBe(false);
  });

  test("passes correct filter for volume name", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "volume", "ls", "-qf"], {
      exitCode: 0,
      stdout: "",
    });
    volumeExists(runner, "staging-b_db_data");
    expect(runner.calls[0]).toEqual(["docker", "volume", "ls", "-qf", "name=staging-b_db_data"]);
  });
});

describe("getWordPressEnvVars", () => {
  test("returns baseline vars when extraction returns nothing", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "exec"], { exitCode: 1, stdout: "" });
    const vars = getWordPressEnvVars(runner, "abc123");
    expect(vars).toContain("WORDPRESS_DB_HOST=db:3306");
    expect(vars).toContain("WORDPRESS_DB_USER=wordpress");
    expect(vars).toContain("WORDPRESS_DB_PASSWORD=wordpress");
    expect(vars).toContain("WORDPRESS_DB_NAME=wordpress");
  });

  test("extracted vars override baseline", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "exec"], {
      exitCode: 0,
      stdout: "WORDPRESS_DB_HOST=custom-db:3307\nWORDPRESS_DB_USER=wp\nHOME=/root\n",
    });
    const vars = getWordPressEnvVars(runner, "abc123");
    expect(vars).toContain("WORDPRESS_DB_HOST=custom-db:3307");
    expect(vars).toContain("WORDPRESS_DB_USER=wp");
    // Baseline values still present for non-overridden keys
    expect(vars).toContain("WORDPRESS_DB_PASSWORD=wordpress");
    expect(vars).toContain("WORDPRESS_DB_NAME=wordpress");
    // Non-WORDPRESS vars excluded
    expect(vars).not.toContain("HOME=/root");
  });

  test("calls docker exec env on the given container", () => {
    const runner = new MockProcessRunner();
    runner.addResponse(["docker", "exec"], { exitCode: 0, stdout: "" });
    getWordPressEnvVars(runner, "mycontainer");
    expect(runner.calls[0]).toEqual(["docker", "exec", "mycontainer", "env"]);
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
