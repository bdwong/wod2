import * as fs from "node:fs";
import * as path from "node:path";

export interface Filesystem {
  /** Returns sorted names of subdirectories in the given directory, or empty array if dir doesn't exist */
  listSubdirectories(dirPath: string): string[];
  /** Creates directory and parents if they don't exist */
  ensureDirectory(dirPath: string): void;
  /** Returns true if the path exists and is a directory */
  isDirectory(dirPath: string): boolean;
  /** Writes content to a file, creating parent directories as needed */
  writeFile(filePath: string, content: string): void;
  /** Reads file content as a string */
  readFile(filePath: string): string;
  /** Returns true if the path exists and is a file */
  fileExists(filePath: string): boolean;
  /** Returns filenames in dir matching a glob pattern (supports * wildcard) */
  globFiles(dir: string, pattern: string): string[];
  /** Returns relative file paths recursively under dirPath */
  listFilesRecursive(dirPath: string): string[];
}

export class RealFilesystem implements Filesystem {
  listSubdirectories(dirPath: string): string[] {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  ensureDirectory(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  isDirectory(dirPath: string): boolean {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, "utf-8");
  }

  readFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf-8");
  }

  fileExists(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  globFiles(dir: string, pattern: string): string[] {
    try {
      const entries = fs.readdirSync(dir);
      const regex = new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      return entries.filter((name) => regex.test(name)).sort();
    } catch {
      return [];
    }
  }

  listFilesRecursive(dirPath: string): string[] {
    try {
      const entries = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const parent = entry.parentPath ?? entry.path;
          const rel = path.relative(dirPath, path.join(parent, entry.name));
          return rel;
        })
        .sort();
    } catch {
      return [];
    }
  }
}
