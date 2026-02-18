import { describe, expect, test } from "bun:test";
import type { CreateConfig } from "../config/create-config.ts";
import { DOCKER_COMPOSE_TEMPLATE, DOCKERFILE_TEMPLATE } from "./php82-template.ts";
import { patchDockerCompose, patchDockerfile } from "./template-patcher.ts";

const defaultConfig: CreateConfig = {
  wordpressVersion: "6.7.1",
  phpVersion: "8.2",
  mysqlVersion: "5.7",
  templateName: "php8.2",
  siteUrl: "http://127.0.0.1:8000",
};

describe("patchDockerfile", () => {
  test("replaces FROM line with configured versions", () => {
    const result = patchDockerfile(DOCKERFILE_TEMPLATE, defaultConfig);
    expect(result).toContain("FROM wordpress:6.7.1-php8.2-apache");
    expect(result).not.toContain("FROM wordpress:6.5.4-php8.2-apache");
  });

  test("uses custom PHP version", () => {
    const config = { ...defaultConfig, wordpressVersion: "5.9", phpVersion: "7.4" };
    const result = patchDockerfile(DOCKERFILE_TEMPLATE, config);
    expect(result).toContain("FROM wordpress:5.9-php7.4-apache");
  });

  test("preserves surrounding content", () => {
    const result = patchDockerfile(DOCKERFILE_TEMPLATE, defaultConfig);
    expect(result).toContain("docker-php-ext-install");
    expect(result).toContain("COPY default.ini");
    expect(result).toContain("AllowOverride All");
  });
});

describe("patchDockerCompose", () => {
  test("replaces mysql image line with configured version", () => {
    const result = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, defaultConfig);
    expect(result).toContain("image: mysql:5.7");
  });

  test("replaces wordpress image line with custom tag", () => {
    const result = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, defaultConfig);
    expect(result).toContain("image: wordpress:6.7.1-php8.2-custom");
    expect(result).not.toContain("image: wordpress:6.5.4-php8.2-custom");
  });

  test("uses custom MySQL version", () => {
    const config = { ...defaultConfig, mysqlVersion: "8.0" };
    const result = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, config);
    expect(result).toContain("image: mysql:8.0");
  });

  test("uses custom WordPress and PHP versions", () => {
    const config = { ...defaultConfig, wordpressVersion: "5.9", phpVersion: "7.4" };
    const result = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, config);
    expect(result).toContain("image: wordpress:5.9-php7.4-custom");
  });

  test("preserves indentation", () => {
    const result = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, defaultConfig);
    const mysqlLine = result.split("\n").find((l) => l.includes("image: mysql:"));
    const wpLine = result.split("\n").find((l) => l.includes("image: wordpress:"));
    expect(mysqlLine).toMatch(/^\s{6}image: mysql:/);
    expect(wpLine).toMatch(/^\s{6}image: wordpress:/);
  });

  test("preserves surrounding content", () => {
    const result = patchDockerCompose(DOCKER_COMPOSE_TEMPLATE, defaultConfig);
    expect(result).toContain("MYSQL_ROOT_PASSWORD: wordpress");
    expect(result).toContain("build: ./wp-php-custom");
    expect(result).toContain("volumes:");
    expect(result).toContain("db_data:");
  });
});
