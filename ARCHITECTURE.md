# WOD (WordPress on Docker) -- Architecture & Reimplementation Guide

This document describes the requirements, architecture, data models, algorithms, and
use cases of WOD in sufficient detail to allow a faithful reimplementation in any
programming language.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Architecture](#3-architecture)
4. [Directory & File Layout](#4-directory--file-layout)
5. [Configuration & Environment Variables](#5-configuration--environment-variables)
6. [CLI Interface](#6-cli-interface)
7. [Command Specifications](#7-command-specifications)
8. [Shared Utility Functions](#8-shared-utility-functions)
9. [Docker Template System](#9-docker-template-system)
10. [Backup / Restore Format](#10-backup--restore-format)
11. [wp-cli Integration](#11-wp-cli-integration)
12. [Installation & Packaging](#12-installation--packaging)
13. [Use Cases & Workflows](#13-use-cases--workflows)
14. [Known Limitations & Future Work](#14-known-limitations--future-work)

---

## 1. Overview

WOD is a command-line tool that creates and manages **disposable WordPress
instances** running in Docker containers on a local machine. Each instance
consists of:

- A **MySQL** database container
- A **custom WordPress** container (Apache + PHP + WordPress)
- A **local directory** holding the `docker-compose.yml`, custom Dockerfile, and
  the WordPress site files

WOD wraps Docker Compose and wp-cli to provide a simple interface for:

- Creating fresh WordPress installations with configurable PHP/MySQL/WP versions
- Restoring WordPress backups (especially UpdraftPlus-format backups)
- Running wp-cli commands against any managed instance
- Listing, starting, stopping, and deleting instances

The original implementation is ~650 lines of Bash spread across 10 shell scripts
plus Docker Compose / Dockerfile templates.

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Create a new WordPress instance with a user-chosen name |
| FR-2 | Configurable WordPress version, PHP version, and MySQL version per instance |
| FR-3 | Restore content and database from UpdraftPlus-format backup archives |
| FR-4 | List all managed instances with running/stopped status |
| FR-5 | Start (bring up) a stopped instance |
| FR-6 | Stop (bring down) a running instance |
| FR-7 | Remove an instance completely (files, containers, volumes) |
| FR-8 | Execute arbitrary wp-cli commands against a running instance |
| FR-9 | Display help text for any command |
| FR-10 | Support a user configuration file for default overrides |
| FR-11 | Coexist with a system-installed wp-cli binary |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Instances are isolated from each other (separate containers, volumes, directories) |
| NFR-2 | Minimal external dependencies: Docker, Docker Compose, standard Unix tools |
| NFR-3 | Each instance's site files are accessible on the host filesystem for editing |
| NFR-4 | The tool must work on Linux; WSL2 support is a goal |
| NFR-5 | File permissions inside containers must use UID/GID 33:33 (www-data) |

### 2.3 External Dependencies

| Dependency | Purpose |
|------------|---------|
| Docker Engine | Container runtime |
| Docker Compose (v2, `docker compose` subcommand) | Multi-container orchestration |
| wp-cli (via `wordpress:cli` Docker image) | WordPress management commands |
| `unzip` | Extracting backup archives |
| `zcat` | Decompressing `.gz` database dumps |
| `sed`, `grep`, `awk` | Text processing in templates and restores |
| `sudo` | File permission operations on site directories |
| `openssl` (optional) | Generating self-signed SSL certificates |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────┐
│                  User (CLI)                     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              bin/wod  (Dispatcher)               │
│  - Parses command name                           │
│  - Routes to lib/wod-<command>                   │
│  - Provides bootstrap for shell integration      │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼────────────────────┐
        ▼            ▼                    ▼
┌──────────┐  ┌──────────┐  ┌───────────────────┐
│ wod-create│  │ wod-ls   │  │ wod-restore       │
│ wod-up   │  │ wod-help │  │ wod-wp            │
│ wod-down │  │          │  │                   │
│ wod-rm   │  │          │  │                   │
└─────┬────┘  └──────────┘  └────────┬──────────┘
      │                              │
      ▼                              ▼
┌──────────────────┐   ┌─────────────────────────┐
│ lib/functions    │   │ Docker Engine            │
│ (shared utils)   │   │  - docker compose up/down│
│                  │   │  - docker run (wp-cli)   │
└──────────────────┘   │  - docker container ls   │
                       │  - docker volume ls/rm   │
┌──────────────────┐   └─────────────────────────┘
│ template/        │
│  (docker-compose │
│   + Dockerfile   │
│   templates)     │
└──────────────────┘
```

### 3.2 Data Flow: Instance Lifecycle

```
create ──► Template copied to WOD_HOME/<name>/
       ──► Dockerfile & docker-compose.yml patched with versions
       ──► docker compose up -d
       ──► Wait 10s for DB startup
       ──► wp core install (fresh WordPress)
       ──► [optional] wod-restore + URL rewrite

up     ──► docker compose up -d  (from instance directory)
       ──► Display site URL via wp option get siteurl

down   ──► docker compose down   (from instance directory)

rm     ──► wod-down (stop containers)
       ──► sudo rm -rf instance directory
       ──► docker volume rm <name>_db_data

ls     ──► Scan WOD_HOME for subdirectories
       ──► For each, check docker container status
       ──► If running, query siteurl via wp-cli
```

### 3.3 Naming Conventions

| Concept | Naming Pattern | Example |
|---------|---------------|---------|
| Instance directory | `WOD_HOME/<name>` | `~/wod/staging-b` |
| WordPress container | `<name>-wordpress-1` | `staging-b-wordpress-1` |
| Database container | `<name>-db-1` | `staging-b-db-1` |
| Database volume | `<name>_db_data` | `staging-b_db_data` |
| Custom Docker image | `wordpress:<WP_VERSION>-php<PHP_VERSION>-custom` | `wordpress:6.7.1-php8.2-custom` |

> **Note on container naming:** Docker Compose names containers as
> `<project>-<service>-<number>`. The project name defaults to the directory
> name. Older Docker versions (between 2019-02 and 2021-02) stripped hyphens
> from project names, so `wod-wp` also checks for the hyphen-stripped variant
> when looking up containers.

---

## 4. Directory & File Layout

### 4.1 Installation Layout

```
/usr/bin/wod                         # Main entry point
/usr/lib/wod/
├── bin/
│   ├── functions                    # Shared utility functions
│   ├── wod-create                   # Create subcommand
│   ├── wod-down                     # Down subcommand
│   ├── wod-help                     # Help subcommand
│   ├── wod-ls                       # List subcommand
│   ├── wod-restore                  # Restore subcommand
│   ├── wod-rm                       # Remove subcommand
│   ├── wod-up                       # Up subcommand
│   ├── wod-wp                       # WP-CLI subcommand
│   └── wp -> wod-wp                 # Symlink
└── template/
    ├── default/                     # PHP 7.1 + mcrypt
    ├── no-mcrypt/                   # PHP 7.1, no mcrypt
    ├── php7.4/                      # PHP 7.4
    ├── php8.1/                      # PHP 8.1
    └── php8.2/                      # PHP 8.2 (default)
```

### 4.2 Runtime Layout (Per Instance)

```
~/wod/                               # WOD_HOME (configurable)
└── <instance-name>/
    ├── docker-compose.yml           # Generated from template
    ├── wp-php-custom/
    │   ├── Dockerfile               # Generated from template
    │   └── default.ini              # PHP config (upload limits)
    └── site/                        # WordPress files (bind-mounted)
        ├── wp-config.php
        ├── wp-content/
        │   ├── plugins/
        │   ├── themes/
        │   ├── uploads/
        │   └── ...
        └── ...
```

### 4.3 User Configuration

```
~/.config/wod/wod.conf               # Optional user defaults
```

---

## 5. Configuration & Environment Variables

### 5.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WOD_HOME` | `~/wod` | Root directory where all instances are stored |
| `SCRIPT_HOME` | `/usr/lib/wod/bin` | Directory containing WOD subcommand scripts |
| `TEMPLATE_DIR` | `/usr/lib/wod/template` | Directory containing Docker templates |
| `TEMPLATE_NAME` | `php8.2` | Which template subdirectory to use |
| `WORDPRESS_VERSION` | `6.7.1` | WordPress version number |
| `PHP_VERSION` | `8.2` | PHP version number |
| `MYSQL_VERSION` | `5.7` | MySQL version number |
| `SITEURL` | `http://127.0.0.1:8000` | Local URL for the WordPress site |
| `WORDPRESS_TAG` | `<computed>` | Full Docker image tag; defaults to `<WP_VERSION>-php<PHP_VERSION>-apache` |
| `BACKUP_PREFIX` | *(none)* | Path to backup directory (alternative to CLI argument) |

### 5.2 Configuration Precedence (Highest to Lowest)

1. **Command-line arguments** (e.g., `wod create mysite /path/to/backup`)
2. **Shell environment variables** (e.g., `WORDPRESS_VERSION=5.9 wod create mysite`)
3. **User config file** (`~/.config/wod/wod.conf`)
4. **Built-in defaults** (hardcoded in `wod-create`)

### 5.3 User Config File Format

The file `~/.config/wod/wod.conf` is a simple `KEY=VALUE` file, one per line.
Lines starting with `#` are comments. The file is loaded using:

```bash
export $(grep -v '^#' $HOME/.config/wod/wod.conf | xargs -d '\n') &>/dev/null
```

Example contents:
```
WORDPRESS_VERSION=6.7.1
PHP_VERSION=8.2
MYSQL_VERSION=5.7
SITEURL=http://127.0.0.1:9000
TEMPLATE_NAME=php8.2
```

---

## 6. CLI Interface

### 6.1 Top-Level Syntax

```
wod <command> [arguments...]
```

If no command is given, help text is printed.

### 6.2 Available Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `create` | `<name> [backup-directory]` | Create a new WordPress instance |
| `ls` | *(none)* | List all instances with status |
| `up` | `<name>` | Start a stopped instance |
| `down` | `<name>` | Stop a running instance |
| `rm` | `<name>` | Remove an instance completely |
| `restore` | `<name> <backup-directory>` | Restore backup into existing instance |
| `wp` | `<name> <wp-cli-command...>` | Run wp-cli command on instance |
| `help` | `<command>` | Show help for a command |
| `bootstrap` | `[functions]` | Output shell initialization code |

### 6.3 Command Dispatch Mechanism

The dispatcher (`bin/wod`):

1. Evaluates its own bootstrap to set up `SCRIPT_HOME` and the `wp` shell
   function.
2. If no argument, sources `functions` and calls `print_help` on itself.
3. If the argument is `bootstrap`, calls `wod_bootstrap` and exits.
4. Otherwise, checks if `$SCRIPT_HOME/wod-<command>` exists:
   - If yes: executes it, passing remaining arguments.
   - If no: prints "Invalid command" and help text, exits with code 1.

### 6.4 Bootstrap Mechanism

The `bootstrap` command outputs shell code to be `eval`'d in `.bashrc`:

```bash
eval `wod bootstrap`
```

This outputs:
```bash
export SCRIPT_HOME=${SCRIPT_HOME:-/usr/lib/wod/bin};
function wp () { ${SCRIPT_HOME}/wp "$@"; };
```

When called with `functions` argument (internal use only), it additionally outputs:
```bash
source ${SCRIPT_HOME}/functions;
```

The `wp` function wrapper allows `wp` typed at the shell to route through WOD's
`wod-wp` script, which provides instance-aware wp-cli execution.

---

## 7. Command Specifications

### 7.1 `wod create <name> [backup-directory]`

**Purpose:** Create a new WordPress Docker instance.

**Arguments:**
- `name` (required): Unique name for the instance
- `backup-directory` (optional): Path to directory containing backup archives

**Algorithm:**

1. Source bootstrap with functions.
2. Validate arguments: exactly 1 or 2 arguments required.
3. Set default configuration values (see Section 5.1).
4. Load user config file if it exists (`~/.config/wod/wod.conf`).
5. Override `TARGET_NAME` from first argument; `BACKUP_PREFIX` from second
   argument (or from config).
6. Compute `WORDPRESS_TAG` as `<WP_VERSION>-php<PHP_VERSION>-apache` unless
   already set.
7. **Prerequisite checks** (all must pass or exit with error):
   a. Target directory must not already exist.
   b. No Docker container with name `<name>_wordpress_*` must exist (running
      or stopped).
   c. No Docker container with name `<name>_db_*` must exist (running or
      stopped).
   d. No Docker volume named `<name>_db_data` must exist.
   e. If `backup-directory` specified, it must be a valid directory.
8. Copy template directory to instance directory:
   ```
   cp -r TEMPLATE_DIR/TEMPLATE_NAME/* TARGET_DIR/
   ```
9. Patch the `Dockerfile`: replace the `FROM` line with:
   ```
   FROM wordpress:<WORDPRESS_TAG>
   ```
10. Patch `docker-compose.yml`:
    - Replace `image: mysql:*` with `image: mysql:<MYSQL_VERSION>`
    - Replace `image: wordpress:*` with `image: wordpress:<WP_VERSION>-php<PHP_VERSION>-custom`
11. **Pause for user confirmation** (print "Ready to run docker-compose up. Press
    Enter to continue" and wait for input).
12. Change to instance directory.
13. Run `docker compose up -d`.
14. Sleep 10 seconds (wait for database initialization).
15. Install WordPress core:
    ```
    wp core install --url=<SITEURL> --title="Testing WordPress"
        --admin_user="admin" --admin_email="admin@127.0.0.1"
    ```
    Note: Password is auto-generated by wp-cli and displayed in output.
16. If `BACKUP_PREFIX` is set:
    a. Run `wod-restore <name> <backup-directory>`.
    b. Update site URL: `wp option set siteurl <SITEURL>`
    c. Update home URL: `wp option set home <SITEURL>`
17. Print "Website ready at `<SITEURL>`".

**Exit codes:**
- 0: Success
- 1: Validation failure (directory exists, container exists, volume exists,
  invalid backup path)

### 7.2 `wod ls`

**Purpose:** List all managed WOD instances and their status.

**Arguments:** None (exits if any arguments given).

**Algorithm:**

1. Source bootstrap with functions.
2. List contents of `WOD_HOME` directory. If empty, print "No wod instances
   found." and exit.
3. Check if Docker daemon is running (store result).
4. Print header:
   ```
   d w |
   b p | name
   ====#=========================
   ```
5. For each subdirectory in `WOD_HOME`:
   a. Print database status character:
      - `E` if Docker is not running
      - `*` if container `<name>-db-*` is running
      - `.` otherwise
   b. Print WordPress status character (same logic with `<name>-wordpress-*`).
   c. If both containers are running:
      - Change to instance directory
      - Query `wp option get siteurl`
      - Print `| <name> at <siteurl>`
   d. Else print `| <name>`

**Output format example:**
```
d w |
b p | name
====#=========================
* * | staging-b at http://127.0.0.1:8000
. . | old-site
```

**Column meanings:**
- `d`/`b` = database status: `*` running, `.` stopped, `E` Docker not running
- `w`/`p` = WordPress status: same encoding

### 7.3 `wod up <name>`

**Purpose:** Start a stopped WordPress instance.

**Arguments:**
- `name` (required): Instance name

**Algorithm:**

1. Source bootstrap with functions.
2. Validate exactly 1 argument.
3. Call `ensure_target` to verify instance directory exists.
4. Change to instance directory.
5. Run `docker compose up -d`.
6. If successful, query and display site URL via `wp option get siteurl`.
7. Print "Website ready at `<SITEURL>`".

**Exit codes:** Passes through the exit code from `docker compose up`.

### 7.4 `wod down <name>`

**Purpose:** Stop a running WordPress instance.

**Arguments:**
- `name` (required): Instance name

**Algorithm:**

1. Source bootstrap with functions.
2. Validate exactly 1 argument.
3. Call `ensure_target` to verify instance directory exists.
4. Change to instance directory.
5. Run `docker compose down`.

**Exit codes:** Passes through the exit code from `docker compose down`.

### 7.5 `wod rm <name>`

**Purpose:** Completely remove an instance (containers, files, volume).

**Arguments:**
- `name` (required): Instance name

**Algorithm:**

1. Source bootstrap with functions.
2. Validate exactly 1 argument.
3. Call `ensure_target` to verify instance directory exists.
4. Print "Removing `<name>`".
5. Acquire sudo credentials (`sudo -v`).
6. If `docker-compose.yml` exists in instance directory, run `wod-down <name>`.
7. If instance directory exists, run `sudo rm -rf <directory>`.
8. Query for Docker volume named `<name>_db_data`; if it exists, run
   `docker volume rm <volume_name>`.

**Notes:**
- Requires sudo because site files are owned by www-data (UID 33).
- The volume lookup uses `docker volume ls -qf "name=<name>_db_data"`.

### 7.6 `wod restore <name> <backup-directory>`

**Purpose:** Restore WordPress content and database from backup archives.

**Arguments:**
- `name` (required): Instance name (must already exist)
- `backup-directory` (required): Path to directory containing backup files

**Expected backup file patterns:**
```
backup*-plugins.zip      # WordPress plugins
backup*-themes.zip       # WordPress themes
backup*-uploads.zip      # Media uploads
backup*-others.zip       # Other wp-content files
backup*-db.gz            # Database dump (UpdraftPlus format)
*.sql.gz                 # Database dump (alternative format)
```

**Algorithm:**

1. Source bootstrap with functions.
2. Validate exactly 2 arguments.
3. Call `ensure_target` to verify instance directory exists.
4. Validate backup directory exists.
5. Change to instance directory.
6. **Restore content archives** -- for each content type in order:
   `plugins`, `themes`, `uploads`, `others`:
   a. If no matching zip files found, print warning and skip.
   b. If the `site/wp-content/<type>` directory exists, delete it
      (`sudo rm -rf`).
   c. For each zip file matching `backup*-<type>*.zip` in the backup directory:
      - Verify the file exists (glob may not expand).
      - Extract to `site/wp-content/` using `sudo unzip -od site/wp-content`.
   d. Note: The content type may be split across multiple zip files (e.g.,
      `backup_2024-01-01-uploads.zip`, `backup_2024-01-01-uploads2.zip`).
7. **Fix file permissions:**
   ```
   sudo chown -R www-data:www-data site/wp-content
   ```
8. **Restore database:**
   a. Look for `backup*-db.gz` in the backup directory.
   b. If not found, fall back to `*.sql.gz`.
   c. If still not found, print warning and skip database restore.
   d. **Extract UpdraftPlus header comments:**
      - Read lines starting with `#` until the first blank line.
      - Parse key-value pairs from header comments in format `# Key: Value`.
      - Convert to shell variables: lowercase, spaces to underscores.
      - Key extracted variable: `table_prefix`.
   e. **Update table prefix** (if found in header):
      - Modify `site/wp-config.php`: replace the `$table_prefix = '...'` line
        with the value from the backup header.
      - Uses sudo for file permission.
   f. **Import database** with SQL compatibility fix:
      - Decompress the gzip file.
      - Apply sed transformations:
        - After the line starting with `# -----`, insert a SQL mode directive:
          ```sql
          /*!40101 SET sql_mode='ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */;
          ```
        - Remove lines starting with `/*M!` (MariaDB-specific directives).
      - Pipe the result to `wp db import -`.

**UpdraftPlus Header Format Example:**
```
# WordPress MySQL database backup
# Created by UpdraftPlus version 1.22.3 (https://updraftplus.com)
# WordPress Version: 5.8.1
# Table prefix: wp_
# Site URL: https://example.com
# ...
```

**Header parsing algorithm:**
1. `zcat` the `.gz` file.
2. Extract lines starting with `#` until the first blank line.
3. For each line containing `: `:
   - Strip the leading `# `.
   - Split on `: ` to get key and value.
   - Lowercase the key.
   - Replace spaces with underscores in the key.
   - Result: `key="value"`.
4. Evaluate the resulting assignments as shell variables.

### 7.7 `wod wp <name> <wp-cli-command...>`

**Purpose:** Execute wp-cli commands against a running WOD instance.

**Arguments:**
- `name` (required, but see below): Instance name
- All remaining arguments are passed to wp-cli

**Instance name detection logic:**

The script can be invoked two ways:

1. **As `wod wp <name> ...`**: The first argument is the instance name,
   remaining args go to wp-cli.
2. **As `wp ...`** (via the shell function/symlink): The instance name is
   auto-detected:
   - If the current working directory is inside `WOD_HOME`, extract the
     instance name from the relative path (first path component after
     `WOD_HOME`).
   - If not inside `WOD_HOME`, fall back to the system `wp` binary (if
     available and different from this script). If no system wp exists, print
     error and exit.

**Algorithm:**

1. Source bootstrap with functions.
2. Determine instance name (see detection logic above).
3. Look up the running WordPress container:
   a. Search for container with name matching `<name>-wordpress`.
   b. If not found, try again with hyphens stripped from the name (for older
      Docker versions that stripped hyphens from project names).
   c. If still not found, print error and exit.
4. Determine input mode:
   - If stdin is a TTY: use `-it` flags for Docker (interactive + pseudo-TTY).
   - If stdin is a pipe: use `-i` flag only (interactive, no TTY).
5. Execute wp-cli via Docker:
   ```
   docker run <input-flags> --rm \
       --env-file <(docker exec <container> /bin/env | grep "^WORDPRESS") \
       --volumes-from <container> \
       --network container:<container> \
       --user 33:33 \
       wordpress:cli wp <wp-cli-args...>
   ```

**Key Docker flags explained:**
- `--env-file <(...)`: Extracts `WORDPRESS_*` environment variables from the
  running container and passes them to the wp-cli container. This ensures
  wp-cli has the correct database credentials.
- `--volumes-from`: Mounts the same volumes as the WordPress container, giving
  wp-cli access to the site files.
- `--network container:<container>`: Shares the network namespace, allowing
  wp-cli to reach the database container via the same hostname (`db`).
- `--user 33:33`: Runs as UID/GID 33 (www-data) to match file ownership in
  the WordPress container. This is a workaround because the wp-cli and
  WordPress containers may have different UID/GID mappings for www-data.

### 7.8 `wod help <command>`

**Purpose:** Display help text for a specific command.

**Arguments:**
- `command` (required): Command name (without `wod-` prefix)

**Algorithm:**

1. Source bootstrap with functions.
2. Validate exactly 1 argument.
3. Check if file `$SCRIPT_HOME/wod-<command>` exists.
4. If yes: call `print_help` on it.
5. If no: print "Command `<command>` not found."

---

## 8. Shared Utility Functions

These functions (defined in `lib/functions`) are sourced by all subcommands.

### `wod_init()`

- Called automatically when `functions` is sourced.
- Sets `WOD_HOME` to `~/wod` if not already set.
- Creates `WOD_HOME` directory if it doesn't exist (`mkdir -p`).

### `print_help(path)`

- Extracts help text from script file headers.
- Reads from line 2 of the file until the first blank line.
- Strips leading `# ` or `#` from each line.
- Parameter: path to the script file. Defaults to `$0` (the currently
  executing script).

**Implementation:** `cat <file> | sed -ne '2,/^$/{s/^#\s\?//;p}'`

### `target_dir(name)`

- Returns the full path: `$WOD_HOME/<name>`.
- Output via `echo` (intended to be captured with command substitution).

### `ensure_target(name)`

- Checks if `target_dir(name)` is an existing directory.
- If not: prints error message and exits with code 1.

### `docker_is_running()`

- Runs `docker version` and returns its exit code.
- Returns 0 if Docker daemon is accessible, non-zero otherwise.

### `ensure_docker()`

- Checks if Docker is running.
- If not: prints "Docker daemon is not running." and exits with code 1.

### `container_is_running(name, service)`

- Checks if a Docker container matching `<name>-<service>-*` is currently
  running.
- Uses `docker container ls -qf "name=<name>-<service>-"` (lists only running
  containers).
- Returns 0 if a container ID is found, 1 otherwise.

### `container_exists(name, service)`

- Same as `container_is_running` but includes stopped containers.
- Uses `docker container ls -aqf "name=<name>-<service>-"` (the `-a` flag
  includes stopped containers).

---

## 9. Docker Template System

### 9.1 Template Structure

Each template is a directory under `TEMPLATE_DIR` containing:

```
<template-name>/
├── docker-compose.yml
└── wp-php-custom/
    ├── Dockerfile
    └── default.ini
```

### 9.2 Available Templates

| Template | Base WP Version | PHP | MySQL | MCrypt | docker-compose version |
|----------|----------------|-----|-------|--------|----------------------|
| `default` | 4.9.6 | 7.1 | 5.7 | Yes | `version: '2'` |
| `no-mcrypt` | 4.9.6 | 7.1 | 5.7 | No | `version: '2'` |
| `php7.4` | latest | 7.4 | 5.7 | No | `version: '2'` |
| `php8.1` | latest | 8.1 | 5.7 | No | *(none)* |
| `php8.2` | 6.5.4 | 8.2 | 5.7 | No | *(none)* |

### 9.3 docker-compose.yml Template

The template defines two services:

```yaml
services:
   db:
      image: mysql:5.7                    # ← Patched by wod-create
      volumes:
         - db_data:/var/lib/mysql
      restart: always
      environment:
         MYSQL_ROOT_PASSWORD: wordpress
         MYSQL_DATABASE: wordpress
         MYSQL_USER: wordpress
         MYSQL_PASSWORD: wordpress

   wordpress:
      depends_on:
         - db
      build: ./wp-php-custom
      image: wordpress:X.X.X-phpX.X-custom  # ← Patched by wod-create
      volumes:
         - ./site:/var/www/html
      ports:
         - "8000:80"
      restart: always
      environment:
         WORDPRESS_DB_HOST: db:3306
         WORDPRESS_DB_USER: wordpress
         WORDPRESS_DB_PASSWORD: wordpress
volumes:
   db_data:
```

**Key design points:**
- The `build` directive points to `./wp-php-custom` which contains the custom
  Dockerfile.
- The `image` directive tags the built image for reuse.
- Site files are bind-mounted at `./site:/var/www/html`.
- Database data persists in the named volume `db_data`.
- Port 8000 is mapped to container port 80.
- Database credentials are hardcoded (`wordpress`/`wordpress`). This is
  acceptable because these are local development instances only.

### 9.4 Dockerfile Template

The Dockerfile builds a custom WordPress image:

```dockerfile
FROM wordpress:<WP_VERSION>-php<PHP_VERSION>-apache     # ← Patched

# Install PHP extensions for image processing
RUN apt-get update && apt-get install -y \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        libpng-dev \
    && docker-php-ext-install -j$(nproc) iconv \
    && docker-php-ext-configure gd \
    && docker-php-ext-install -j$(nproc) gd

# PHP config: increase upload limits
COPY default.ini /usr/local/etc/php/conf.d/default.ini

# Apache: AllowOverride All for .htaccess support
RUN sed -i \
        -e '/<\/VirtualHost>/i\' \
        -e '        <Directory "/var/www/html">\' \
        -e '                Options Indexes FollowSymLinks MultiViews\' \
        -e '                AllowOverride All\' \
        -e '        </Directory>' \
        /etc/apache2/sites-available/000-default.conf
```

**Variations by template:**
- `default` template adds `libmcrypt-dev` and `mcrypt` PHP extension.
- `default` template uses `--with-freetype-dir=/usr/include/
  --with-jpeg-dir=/usr/include/` for `gd` configure (PHP 7.1 syntax).
- Modern templates (php7.4+) use the simplified `gd` configure syntax.

### 9.5 default.ini

```ini
upload_max_filesize=100M
post_max_size = 100M
```

### 9.6 Template Patching (wod-create)

During instance creation, the template files are patched:

1. **Dockerfile `FROM` line:**
   ```
   sed -i -e "s/^FROM.*$/FROM wordpress:<WORDPRESS_TAG>/"
   ```
   Where `WORDPRESS_TAG` = `<WP_VERSION>-php<PHP_VERSION>-apache`.

2. **docker-compose.yml `image` lines:**
   ```
   sed -i \
       -e "s/^\([[:space:]]*\)image: mysql.*$/\1image: mysql:<MYSQL_VERSION>/" \
       -e "s/^\([[:space:]]*\)image: wordpress.*$/\1image: wordpress:<WP_VERSION>-php<PHP_VERSION>-custom/"
   ```

---

## 10. Backup / Restore Format

### 10.1 Supported Backup Format

WOD supports **UpdraftPlus**-style backup archives. The backup directory
should contain:

| File Pattern | Content | Required |
|-------------|---------|----------|
| `backup*-plugins.zip` | `wp-content/plugins/` directory | Optional |
| `backup*-themes.zip` | `wp-content/themes/` directory | Optional |
| `backup*-uploads.zip` | `wp-content/uploads/` directory | Optional |
| `backup*-others.zip` | Other `wp-content/` files | Optional |
| `backup*-db.gz` | Gzipped MySQL dump | Optional (warns if missing) |
| `*.sql.gz` | Gzipped MySQL dump (fallback) | Fallback for db |

### 10.2 Multi-Part Archives

Content archives can be split into multiple files. The glob pattern
`backup*-<type>*.zip` matches all parts. For example:
- `backup_2024-01-uploads.zip`
- `backup_2024-01-uploads2.zip`

All matching files are extracted sequentially into the same destination.

### 10.3 Database Dump Format

The `.gz` file contains a MySQL dump with optional UpdraftPlus header
comments:

```sql
# WordPress MySQL database backup
# Created by UpdraftPlus version 1.22.3
# Table prefix: wp_custom_
# Site URL: https://example.com
#
# -----
CREATE TABLE ...
```

### 10.4 Database Import Processing

The raw SQL dump is processed before import:

1. **SQL mode fix:** After the `# -----` separator line, a SQL mode directive
   is inserted to prevent strict-mode errors with legacy data:
   ```sql
   /*!40101 SET sql_mode='ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */;
   ```

2. **MariaDB directive removal:** Lines starting with `/*M!` are removed.
   These are MariaDB-specific directives that MySQL does not understand.

3. The processed dump is piped to `wp db import -`.

---

## 11. wp-cli Integration

### 11.1 Execution Model

WOD does **not** install wp-cli on the host or inside the WordPress container.
Instead, it uses the official `wordpress:cli` Docker image, which is run as a
sidecar container that:

- Shares volumes with the running WordPress container
- Shares the network namespace with the running WordPress container
- Runs as UID/GID 33:33 (www-data)
- Receives `WORDPRESS_*` environment variables extracted from the running
  container

This means wp-cli has full access to the WordPress files and can communicate
with the database, but runs in its own ephemeral container that is removed
after each command (`--rm`).

### 11.2 TTY Detection

When stdin is a TTY (interactive shell), Docker is invoked with `-it`.
When stdin is a pipe (e.g., `echo "SELECT 1" | wod wp mysite db query`),
Docker is invoked with `-i` only (no pseudo-TTY).

### 11.3 System wp-cli Coexistence

When invoked as `wp` (via the symlink or shell function):

1. If the current directory is inside `WOD_HOME`, auto-detect the instance.
2. If outside `WOD_HOME`, look for a system `wp` binary and delegate to it.
3. If no system `wp` exists, print error.

This allows WOD to coexist with a globally installed wp-cli.

---

## 12. Installation & Packaging

### 12.1 Makefile Targets

| Target | Description |
|--------|-------------|
| `make install` | Install everything (bin + lib + templates) |
| `make uninstall` | Remove all installed files |
| `make bin` | Install only the main `wod` script to `/usr/bin/` |
| `make lib` | Install library scripts to `/usr/lib/wod/bin/` |
| `make templates` | Install Docker templates to `/usr/lib/wod/template/` |

### 12.2 Installation Paths

| Source | Destination |
|--------|-------------|
| `bin/wod` | `/usr/bin/wod` |
| `lib/*` | `/usr/lib/wod/bin/` |
| `template/*/` | `/usr/lib/wod/template/` |

### 12.3 File Permissions

- Scripts are installed with `install` (executable permissions).
- Template files are installed with `install -Dm 644` (read-only).

---

## 13. Use Cases & Workflows

### 13.1 Fresh WordPress Development Site

```
wod create devsite
# → Creates a fresh WordPress 6.7.1 instance at http://127.0.0.1:8000
# → Admin user: admin, password: auto-generated
```

### 13.2 Restore Production Backup for Testing

```
# Download UpdraftPlus backup files to a local directory
wod create staging ~/backups/production-2024-01/
# → Creates instance, restores content + database, updates URLs
```

### 13.3 Restore Backup to Existing Instance

```
wod create testsite
wod restore testsite ~/backups/mysite/
wod wp testsite search-replace https://example.com http://127.0.0.1:8000
wod wp testsite option set siteurl http://127.0.0.1:8000
wod wp testsite option set home http://127.0.0.1:8000
```

### 13.4 Test with Different PHP Versions

```
TEMPLATE_NAME=php7.4 PHP_VERSION=7.4 wod create legacy-test
TEMPLATE_NAME=php8.2 PHP_VERSION=8.2 wod create modern-test
```

### 13.5 Manage Multiple Sites

```
wod ls
# d w |
# b p | name
# ====#=========================
# * * | staging-b at http://127.0.0.1:8000
# . . | old-site
# * * | devsite at http://127.0.0.1:9000

wod down staging-b
wod up old-site
wod rm devsite
```

### 13.6 Run wp-cli Commands

```
# List plugins
wod wp mysite plugin list

# Install and activate a plugin
wod wp mysite plugin install woocommerce --activate

# Export the database
wod wp mysite db export - > backup.sql

# Search and replace URLs
wod wp mysite search-replace http://old.com http://new.com

# Run arbitrary WP-CLI commands
wod wp mysite user list
wod wp mysite cache flush
```

### 13.7 Working Within an Instance Directory

```
cd ~/wod/mysite
# The `wp` command auto-detects the instance from CWD
wp plugin list
wp option get siteurl
```

---

## 14. Known Limitations & Future Work

These items are documented in `TODO.md` and observed in the code:

1. **No image tag validation:** `wod create` does not verify that the
   computed WordPress or MySQL Docker image tag actually exists before
   attempting to build/pull.

2. **Port not configurable per instance:** The port `8000` is hardcoded in the
   docker-compose template. Running multiple instances simultaneously requires
   manually editing the generated `docker-compose.yml`.

3. **Container name matching with hyphens:** Instance names containing
   hyphens may cause issues with Docker container lookups due to historical
   Docker behavior of stripping hyphens from project names. The code has a
   workaround but it may not cover all edge cases.

4. **Instance names with dots:** Names containing dots (`.`) may cause
   container name lookup failures (documented as a bug in `TODO.md`).

5. **No WordPress version auto-detection:** When restoring from backup,
   WOD cannot automatically determine the original WordPress version from
   the database dump.

6. **Hardcoded database credentials:** All instances use `wordpress` /
   `wordpress` for MySQL credentials. This is acceptable for local
   development but would need to change for any shared use.

7. **sudo requirement:** File operations on `site/wp-content/` require sudo
   because the files are owned by `www-data` (UID 33) inside the container.

8. **Single port conflicts:** If multiple instances need to run
   simultaneously, their ports must be manually differentiated.

9. **.htaccess handling:** The restore process may overwrite existing
   `.htaccess` files without backup.

10. **Template documentation:** The template system (multiple PHP version
    templates) is not yet documented in user-facing help.

---

## Appendix A: Complete Command Reference

```
wod                             # Show help
wod help <command>              # Show help for a command
wod create <name> [backup-dir] # Create new instance
wod ls                          # List all instances
wod up <name>                   # Start instance
wod down <name>                 # Stop instance
wod rm <name>                   # Remove instance
wod restore <name> <backup-dir> # Restore backup
wod wp <name> <command...>      # Run wp-cli command
wod bootstrap [functions]       # Output shell init code
```

## Appendix B: Docker Container Lookup Patterns

| Docker Command | Pattern | Purpose |
|---------------|---------|---------|
| `docker container ls -qf "name=X-Y-"` | Running containers | Check if running |
| `docker container ls -aqf "name=X-Y-"` | All containers | Check if exists |
| `docker container ls -q -f name=X-wordpress` | WordPress container | Find for wp-cli |
| `docker volume ls -qf "name=X_db_data"` | Named volume | Check/delete volume |

## Appendix C: Exit Code Conventions

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation error, missing argument, or target not found |
| (other) | Passed through from Docker commands |

## Appendix D: File Permission Model

| Path | Owner | Permissions | Notes |
|------|-------|-------------|-------|
| Instance directory | User | Standard | Created by `mkdir` |
| `site/` contents | `www-data` (33:33) | Standard | Created by WordPress container |
| `wp-content/` (after restore) | `www-data` (33:33) | Standard | Fixed by `chown -R` |
| wp-cli operations | UID 33 / GID 33 | N/A | `--user 33:33` flag |
