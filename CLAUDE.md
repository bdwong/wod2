# CLAUDE.md — Development Guide for wod2

## Project Overview

wod2 is a TypeScript reimplementation of WOD (WordPress on Docker), a CLI tool for managing disposable WordPress instances in Docker containers. The original was ~650 lines of Bash across 10 shell scripts. See `ARCHITECTURE.md` for the full specification.

## Execution Environment

This project is developed on **Windows with WSL2 (Ubuntu 24.04)**. All shell commands must be run inside WSL2, not in the Windows shell or Git Bash.

To run commands, use the `wsl` prefix to invoke bash inside WSL2:
```bash
wsl bash -c "export PATH=\$HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && cd ~/src/bdwong/wod2 && <command>"
```

The Windows `PATH` contains spaces and parentheses that break shell expansion in WSL2's login shell, so we set a clean `PATH` explicitly and prepend `~/.bun/bin` for Bun access.

**Project paths:**
- **Windows path:** `\\wsl.localhost\Ubuntu-24.04\home\bdwong\src\bdwong\wod2`
- **WSL2 path:** `~/src/bdwong/wod2`

## Tech Stack

- **Runtime:** Bun (primary), with Node.js compatibility as a goal
- **Language:** TypeScript (strict mode)
- **Module system:** ESM (`"type": "module"`)
- **Package manager:** Bun (`bun install`, `bun.lock`)
- **CLI framework:** Commander.js (`commander`) for command dispatch and argument parsing
- **Linter/Formatter:** Biome (`@biomejs/biome`)

## Development Workflow

### Test-Driven Development

Write tests before implementation. Follow the red-green-refactor cycle:
1. Write a failing test
2. Write the minimum code to make it pass
3. Refactor while keeping tests green

Use Bun's built-in test runner:
```bash
bun test                  # Run all tests
bun test --watch          # Watch mode
bun test path/to/file     # Run specific test file
```

Test files live alongside source files using the naming convention `*.test.ts`.

### Linting & Formatting

Use Biome for linting and formatting:
```bash
bunx biome check .        # Check lint + format
bunx biome check --write . # Auto-fix lint + format issues
bunx biome format .       # Format only
bunx biome lint .         # Lint only
```

Run lint/format checks before committing.

### Git Workflow

- Commit frequently with clear, descriptive messages
- Keep commits focused — one logical change per commit
- Run tests and lint checks before committing

## Code Conventions

### TypeScript Style

- Use `strict: true` (already configured in `tsconfig.json`)
- Prefer `const` over `let`; avoid `var`
- Use explicit return types on exported functions
- Use `type` imports for type-only imports: `import type { Foo } from "./bar.ts"`
- Use `.ts` extensions in import paths (required by Bun's bundler resolution)
- Prefer `Error` subclasses for domain-specific errors
- Avoid `any`; use `unknown` when the type is truly unknown

### Formatting (Biome)

- Biome collapses short arrays, function arguments, and chained method calls onto a single line when they fit within the line width. Write them single-line to avoid reformatting:
  ```typescript
  // Good — matches Biome output
  const result = processRunner.run(["bash", "-c", `zcat "${dbPath}" | head -50`]);
  const wpEnvVars = envResult.stdout.split("\n").filter((line) => line.startsWith("WORDPRESS"));

  // Bad — Biome will collapse these to single lines
  const result = processRunner.run([
    "bash",
    "-c",
    `zcat "${dbPath}" | head -50`,
  ]);
  ```
- When in doubt, run `bunx biome check --write .` to auto-fix formatting before committing.

### Naming Conventions

- Files: `kebab-case.ts` (e.g., `docker-compose.ts`, `wod-create.ts`)
- Types/Interfaces: `PascalCase` (e.g., `InstanceConfig`, `BackupManifest`)
- Functions/variables: `camelCase` (e.g., `createInstance`, `targetDir`)
- Constants: `UPPER_SNAKE_CASE` for environment-derived config, `camelCase` for other constants
- Test files: `*.test.ts` alongside the module they test

### Project Structure

```
src/
├── cli/              # CLI entry point and command routing
├── commands/         # Command implementations (create, ls, up, down, rm, restore, wp)
├── docker/           # Docker and Docker Compose interactions
├── config/           # Configuration loading and defaults
├── templates/        # Docker Compose and Dockerfile templates
└── utils/            # Shared utility functions
```

### Error Handling

- Use typed errors for expected failure modes (validation errors, missing instances, Docker failures)
- Let unexpected errors propagate
- Exit codes: 0 for success, 1 for validation/user errors, pass through Docker exit codes

### Process Execution

- Use Bun's `Bun.spawn()` or `Bun.spawnSync()` for running external commands (Docker, etc.)
- For Node.js compatibility, consider abstracting process execution behind an interface
- Handle stdin TTY detection for interactive Docker commands (wp-cli)

## Key Architecture Decisions

- The CLI dispatches commands matching the pattern from the original Bash implementation (`wod <command> [args]`)
- Docker Compose templates are embedded or bundled with the application rather than installed to `/usr/lib/wod/`
- Configuration follows the same precedence: CLI args > env vars > config file > defaults
- wp-cli runs via the `wordpress:cli` Docker image as a sidecar container (not installed on host)

## External Dependencies

Runtime requirements (not npm packages):
- Docker Engine
- Docker Compose v2 (`docker compose` subcommand)
- `unzip` (for backup restore)

## Useful Commands

```bash
bun run index.ts          # Run the application
bun run build             # Build single-file executable to dist/wod
bun test                  # Run tests
bunx biome check --write . # Fix lint + format
```
