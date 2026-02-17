import * as fs from "node:fs";

export interface Filesystem {
  /** Returns sorted names of subdirectories in the given directory, or empty array if dir doesn't exist */
  listSubdirectories(dirPath: string): string[];
  /** Creates directory and parents if they don't exist */
  ensureDirectory(dirPath: string): void;
  /** Returns true if the path exists and is a directory */
  isDirectory(dirPath: string): boolean;
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
}
