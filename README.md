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
| `wod create <name> --http-port 9000 --https-port 9443` | Create with custom ports |
| `wod ls` | List all instances with status |
| `wod up <name>` | Start a stopped instance |
| `wod up <name> --http-port 9000 --https-port 9443` | Start with different ports (overwrites `.env`) |
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

# Create with custom ports
wod create mysite --https-port 9443

# Remove an instance
wod rm mysite
```

### Custom ports

By default, instances map HTTP to port 8000 and HTTPS to port 8443. Use `--http-port` and `--https-port` to override these on `wod create` or `wod up`:

```bash
wod create site1 --http-port 9000 --https-port 9443
wod up site1 --https-port 9443
```

Port settings are stored in a `.env` file in the instance directory and are read automatically by Docker Compose on subsequent `wod up` calls (no flags needed).

### Rebuilding after template changes

`wod create` automatically builds the custom Docker image. If you later update the templates (via `wod install`) or modify the Dockerfile in an existing instance, rebuild the image manually:

```bash
cd ~/wod/mysite
docker compose build
docker compose up -d
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
