import type { Filesystem } from "./filesystem.ts";

export class MockFilesystem implements Filesystem {
  private directories: Map<string, string[]> = new Map();
  private existingDirs: Set<string> = new Set();
  private existingDirsConfigured = false;
  public ensuredDirs: string[] = [];

  setSubdirectories(dirPath: string, names: string[]): void {
    this.directories.set(dirPath, names);
  }

  addDirectory(dirPath: string): void {
    this.existingDirsConfigured = true;
    this.existingDirs.add(dirPath);
  }

  listSubdirectories(dirPath: string): string[] {
    return this.directories.get(dirPath) ?? [];
  }

  ensureDirectory(dirPath: string): void {
    this.ensuredDirs.push(dirPath);
  }

  isDirectory(dirPath: string): boolean {
    if (!this.existingDirsConfigured) return true;
    return this.existingDirs.has(dirPath);
  }
}
