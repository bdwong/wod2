import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RealFilesystem } from "./filesystem.ts";

describe("RealFilesystem", () => {
  const filesystem = new RealFilesystem();
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wod-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("listSubdirectories", () => {
    test("returns sorted directory names", () => {
      fs.mkdirSync(path.join(tmpDir, "bravo"));
      fs.mkdirSync(path.join(tmpDir, "alpha"));
      fs.mkdirSync(path.join(tmpDir, "charlie"));

      const result = filesystem.listSubdirectories(tmpDir);
      expect(result).toEqual(["alpha", "bravo", "charlie"]);
    });

    test("excludes files, only returns directories", () => {
      fs.mkdirSync(path.join(tmpDir, "site-a"));
      fs.writeFileSync(path.join(tmpDir, "notes.txt"), "hello");

      const result = filesystem.listSubdirectories(tmpDir);
      expect(result).toEqual(["site-a"]);
    });

    test("returns empty array for non-existent directory", () => {
      const result = filesystem.listSubdirectories(path.join(tmpDir, "nope"));
      expect(result).toEqual([]);
    });

    test("returns empty array for empty directory", () => {
      const result = filesystem.listSubdirectories(tmpDir);
      expect(result).toEqual([]);
    });
  });

  describe("ensureDirectory", () => {
    test("creates nested directories", () => {
      const nested = path.join(tmpDir, "a", "b", "c");
      filesystem.ensureDirectory(nested);
      expect(fs.existsSync(nested)).toBe(true);
      expect(fs.statSync(nested).isDirectory()).toBe(true);
    });

    test("succeeds if directory already exists", () => {
      filesystem.ensureDirectory(tmpDir);
      expect(fs.existsSync(tmpDir)).toBe(true);
    });
  });

  describe("isDirectory", () => {
    test("returns true for directories", () => {
      expect(filesystem.isDirectory(tmpDir)).toBe(true);
    });

    test("returns false for files", () => {
      const file = path.join(tmpDir, "file.txt");
      fs.writeFileSync(file, "content");
      expect(filesystem.isDirectory(file)).toBe(false);
    });

    test("returns false for non-existent paths", () => {
      expect(filesystem.isDirectory(path.join(tmpDir, "nope"))).toBe(false);
    });
  });

  describe("writeFile", () => {
    test("writes content to a file", () => {
      const filePath = path.join(tmpDir, "test.txt");
      filesystem.writeFile(filePath, "hello world");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("hello world");
    });

    test("overwrites existing file", () => {
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, "old content");
      filesystem.writeFile(filePath, "new content");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("new content");
    });
  });

  describe("listFilesRecursive", () => {
    test("returns relative paths of all files recursively", () => {
      fs.mkdirSync(path.join(tmpDir, "sub"));
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tmpDir, "sub", "b.txt"), "b");
      const result = filesystem.listFilesRecursive(tmpDir);
      expect(result).toEqual(["a.txt", "sub/b.txt"]);
    });

    test("excludes directories from results", () => {
      fs.mkdirSync(path.join(tmpDir, "emptydir"));
      fs.writeFileSync(path.join(tmpDir, "file.txt"), "content");
      const result = filesystem.listFilesRecursive(tmpDir);
      expect(result).toEqual(["file.txt"]);
    });

    test("returns empty array for non-existent directory", () => {
      const result = filesystem.listFilesRecursive(path.join(tmpDir, "nope"));
      expect(result).toEqual([]);
    });

    test("returns sorted results", () => {
      fs.writeFileSync(path.join(tmpDir, "z.txt"), "z");
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
      const result = filesystem.listFilesRecursive(tmpDir);
      expect(result).toEqual(["a.txt", "z.txt"]);
    });
  });
});
