import type { Filesystem } from "./filesystem.ts";

export class MockFilesystem implements Filesystem {
  private directories: Map<string, string[]> = new Map();
  public ensuredDirs: string[] = [];

  setSubdirectories(dirPath: string, names: string[]): void {
    this.directories.set(dirPath, names);
  }

  listSubdirectories(dirPath: string): string[] {
    return this.directories.get(dirPath) ?? [];
  }

  ensureDirectory(dirPath: string): void {
    this.ensuredDirs.push(dirPath);
  }

  isDirectory(_dirPath: string): boolean {
    return true;
  }
}
