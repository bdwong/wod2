# wod2

Manage disposable WordPress containers with Docker, i.e. WordPress on Docker.

A TypeScript reimplementation of [WOD](https://github.com/bdwong/wod), a CLI tool for spinning up throwaway WordPress instances backed by Docker Compose.

## Prerequisites

- [Bun](https://bun.sh/) (build and development)
- Docker Engine
- Docker Compose v2 (`docker compose` subcommand)
- `unzip` (for backup restore)
- `openssl` (for TLS certificate generation)
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

Global options:

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Show docker commands and their output |

### Commands

| Command | Description |
|---------|-------------|
| `wod create <name> [backup-dir]` | Create a new WordPress instance, optionally restoring from a backup |
| `wod update <name>` | Update instance PHP/WordPress versions and rebuild |
| `wod ls` | List all instances with status |
| `wod up <name>` | Start a stopped instance |
| `wod down <name>` | Stop a running instance |
| `wod rm <name>` | Remove an instance completely |
| `wod restore <name> <backup-dir>` | Restore a backup into an existing instance |
| `wod wp <name> [args...]` | Run a wp-cli command on a running instance |
| `wod install` | Extract bundled templates to `~/wod/.template/` for customization |

#### `create` options

| Option | Description |
|--------|-------------|
| `--http-port <port>` | HTTP port (default: 8000) |
| `--https-port <port>` | HTTPS port (default: 8443) |
| `--php-version <version>` | PHP version (default: 8.5) |
| `--wordpress-version <version>` | WordPress version (default: 6.9.1) |
| `--template <name>` | Template name (default: custom) |
| `--hostnames <hostnames>` | Comma-separated hostnames for SSL cert and container `/etc/hosts` |
| `--keep-urls` | Keep original siteurl and home from backup (when restoring) |

#### `update` options

| Option | Description |
|--------|-------------|
| `--php-version <version>` | PHP version |
| `--wordpress-version <version>` | WordPress version |
| `--template <name>` | Template name |
| `--hostnames <hostnames>` | Comma-separated hostnames for SSL cert and container `/etc/hosts` |

#### `up` options

| Option | Description |
|--------|-------------|
| `--http-port <port>` | HTTP port (override .env) |
| `--https-port <port>` | HTTPS port (override .env) |

#### `restore` options

| Option | Description |
|--------|-------------|
| `--keep-urls` | Keep original siteurl and home from backup |
| `--site-url <url>` | Override site URL (default: `https://127.0.0.1:<HTTPS_PORT>`) |

### Examples

```bash
# Create a fresh WordPress instance
wod create mysite
# => Site available at https://127.0.0.1:8443

# Create and restore from a backup
wod create mysite /path/to/backup

# Create with a specific PHP and WordPress version
wod create mysite --php-version 8.3 --wordpress-version 6.5

# Create with custom hostnames (adds SSL cert and /etc/hosts entries)
wod create mysite --hostnames mysite.local,www.mysite.local

# Create with custom ports
wod create mysite --https-port 9443

# List instances
wod ls

# Stop and start
wod down mysite
wod up mysite

# Run wp-cli commands
wod wp mysite plugin list
wod wp mysite user list

# Update an instance to a new PHP version (rebuilds the image)
wod update mysite --php-version 8.4

# Restore a backup, keeping the original site URLs
wod restore mysite /path/to/backup --keep-urls

# Extract bundled templates for customization
wod install

# Run any command with verbose Docker output
wod -v create mysite

# Remove an instance
wod rm mysite
```

### Custom ports

By default, instances map HTTP to port 8000 and HTTPS to port 8443. The default site URL is `https://127.0.0.1:8443`. Use `--http-port` and `--https-port` to override these on `wod create` or `wod up`:

```bash
wod create site1 --http-port 9000 --https-port 9443
wod up site1 --https-port 9443
```

Port settings are stored in a `.env` file in the instance directory and are read automatically by Docker Compose on subsequent `wod up` calls (no flags needed).

### Updating instances

Use `wod update` to change PHP or WordPress versions on an existing instance. This regenerates the Dockerfile and Docker Compose configuration from templates and rebuilds the image:

```bash
wod update mysite --php-version 8.4
wod update mysite --wordpress-version 6.8
```

If you've extracted templates with `wod install` and made manual edits, you can also rebuild directly:

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
