import type { Filesystem } from "./filesystem.ts";

export class MockFilesystem implements Filesystem {
  private directories: Map<string, string[]> = new Map();
  private existingDirs: Set<string> = new Set();
  private existingDirsConfigured = false;
  private files: Map<string, string> = new Map();
  private dirFiles: Map<string, string[]> = new Map();
  public ensuredDirs: string[] = [];
  public writtenFiles: Map<string, string> = new Map();

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
    if (this.existingDirsConfigured) {
      this.existingDirs.add(dirPath);
    }
  }

  isDirectory(dirPath: string): boolean {
    if (!this.existingDirsConfigured) return true;
    return this.existingDirs.has(dirPath);
  }

  writeFile(filePath: string, content: string): void {
    this.writtenFiles.set(filePath, content);
  }

  addFile(filePath: string, content: string): void {
    this.files.set(filePath, content);
  }

  setDirFiles(dir: string, filenames: string[]): void {
    this.dirFiles.set(dir, filenames);
  }

  readFile(filePath: string): string {
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw new Error(`MockFilesystem: file not found: ${filePath}`);
    }
    return content;
  }

  fileExists(filePath: string): boolean {
    return this.files.has(filePath);
  }

  globFiles(dir: string, pattern: string): string[] {
    const entries = this.dirFiles.get(dir) ?? [];
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    return entries.filter((name) => regex.test(name)).sort();
  }
}
