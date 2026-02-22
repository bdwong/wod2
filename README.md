# wod2

Manage disposable WordPress containers with Docker, i.e. WordPress on Docker.

A TypeScript reimplementation of [WOD](https://github.com/bdwong/wod), a CLI tool for spinning up throwaway WordPress instances backed by Docker Compose.

## Prerequisites

- [Bun](https://bun.sh/) (build and development)
- Docker Engine
- Docker Compose v2 (`docker compose` subcommand)
- `unzip` (for backup restore)
- `sudo` access (Docker commands)

## Build

```bash
bun install
bun run build
```

This produces a standalone executable at `dist/wod`. Copy it somewhere on your `PATH`:

```bash
sudo cp dist/wod /usr/local/bin/
```

## Usage

```
wod <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `wod create <name> [backup-dir]` | Create a new WordPress instance, optionally restoring from a backup |
| `wod ls` | List all instances with status |
| `wod up <name>` | Start a stopped instance |
| `wod down <name>` | Stop a running instance |
| `wod rm <name>` | Remove an instance completely |
| `wod restore <name> <backup-dir>` | Restore a backup into an existing instance |
| `wod wp <name> [args...]` | Run a wp-cli command on a running instance |

### Examples

```bash
# Create a fresh WordPress instance
wod create mysite

# Create and restore from a backup
wod create mysite /path/to/backup

# List instances
wod ls

# Stop and start
wod down mysite
wod up mysite

# Run wp-cli commands
wod wp mysite plugin list
wod wp mysite user list

# Remove an instance
wod rm mysite
```

## Development

### Running from source

```bash
bun install
bun run index.ts create mysite
```

### Tests

```bash
bun test
```

### Linting & formatting

```bash
bunx biome check --write .
```
