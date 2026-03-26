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

A key aspiration is the ability to quickly bring up **any version of WordPress
on any version of PHP** for debugging and compatibility testing. The `custom`
template (now the default) builds from bare `php:X.Y-apache` images and installs
WordPress directly from wordpress.org, enabling arbitrary PHP + WordPress version
combinations beyond what Docker Hub's official `wordpress` image publishes.

WOD wraps Docker Compose and wp-cli to provide a simple interface for:

- Creating fresh WordPress installations with configurable PHP/MySQL/WP versions
- Restoring WordPress backups (especially UpdraftPlus-format backups)
- Running wp-cli commands against any managed instance
- Listing, starting, stopping, and deleting instances

The original implementation is ~650 lines of Bash spread across 10 shell scripts
plus Docker Compose / Dockerfile templates. The reimplementation (wod2) is in
TypeScript and moves away from shelling out to CLI utilities (`sed`, `grep`,
`awk`, etc.) where it makes sense, preferring in-process solutions such as
Handlebars for template rendering and native string processing for text
manipulation. External process invocations are reserved for operations that
genuinely require them, such as Docker and `sudo`.

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
| FR-10 | Update an existing instance with new PHP/WordPress versions |
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
| `sudo` | File permission operations on site directories |
| `openssl` | Generating self-signed TLS certificates with SANs |

> **Note:** The original Bash implementation also depended on `grep`, `awk`,
> `sed`, and `zcat` for template patching, text processing, and database
> import pipelines. The wod2 reimplementation handles template rendering
> in-process with Handlebars, performs string manipulation natively in
> TypeScript, and uses Node.js `zlib` streams for gzip decompression and
> SQL transformation during database restore — eliminating all of these
> external tool dependencies.

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
│       index.ts → cli.ts (Commander.js)          │
│  - createProgram() registers subcommands        │
│  - Each subcommand has argument/option defs     │
│    and an action handler                        │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼────────────────────┐
        ▼            ▼                    ▼
┌──────────────┐ ┌──────────┐ ┌───────────────────┐
│ commands/    │ │ commands/ │ │ commands/          │
│  create.ts   │ │  ls.ts   │ │  restore.ts        │
│  up.ts       │ │          │ │  wp.ts             │
│  down.ts     │ │          │ │  update.ts         │
│  rm.ts       │ │          │ │  install.ts        │
└─────┬────────┘ └──────────┘ └────────┬──────────┘
      │                                │
      ▼                                ▼
┌──────────────────┐   ┌─────────────────────────┐
│ docker/          │   │ Docker Engine            │
│  docker.ts       │   │  - docker compose up/down│
│  process-runner  │   │  - docker run (wp-cli)   │
│                  │   │  - docker container ls   │
│ config/          │   │  - docker volume ls/rm   │
│  config.ts       │   └─────────────────────────┘
│  create-config   │
│                  │
│ utils/           │
│  filesystem.ts   │
│                  │
│ templates/       │
│  template-engine │
│  template-vars   │
│  template-resolver│
│  bundled-templates│
└──────────────────┘
```

### 3.2 Data Flow: Instance Lifecycle

```
create ──► Validate instance name (no slashes, no leading dot)
       ──► Prerequisite checks (no existing dir, containers, or volume)
       ──► Template resolved (user-customized or bundled)
       ──► Handlebars renders .hbs files to WOD_HOME/<name>/
       ──► Write .env file (HTTP_PORT, HTTPS_PORT, HOSTNAMES)
       ──► Generate self-signed TLS certificate with SANs via openssl
       ──► docker compose up --build -d
       ──► Wait 10s for DB startup
       ──► wp core install (fresh WordPress)
       ──► wp eval to set up pretty permalinks and write .htaccess
       ──► [optional] restore backup + URL rewrite

up     ──► [optional] Write port overrides to .env file
       ──► docker compose up -d  (from instance directory)
       ──► Display site URL via wp option get siteurl

down   ──► docker compose down   (from instance directory)

rm     ──► docker compose down (stop containers)
       ──► sudo rm -rf instance directory
       ──► docker volume rm <name>_db_data

update ──► docker compose down (stop containers)
       ──► Re-render template files with new version vars
       ──► Regenerate self-signed TLS certificate
       ──► docker compose up --build -d

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
| Custom Docker image | `wordpress:<WP_VERSION>-php<PHP_VERSION>-custom` | `wordpress:6.9.1-php8.5-custom` |

> **Note on container naming:** Docker Compose names containers as
> `<project>-<service>-<number>`. The project name defaults to the directory
> name. Older Docker versions (between 2019-02 and 2021-02) stripped hyphens
> from project names, so `wod-wp` also checks for the hyphen-stripped variant
> when looking up containers.

---

## 4. Directory & File Layout

### 4.1 Installation Layout

**Original Bash implementation:**

```
/usr/bin/wod                         # Main entry point
/usr/lib/wod/
├── bin/
│   ├── functions                    # Shared utility functions
│   ├── wod-create, wod-down, ...   # Subcommand scripts
│   └── wp -> wod-wp                # Symlink
└── template/
    ├── default/                     # PHP 7.1 + mcrypt
    ├── no-mcrypt/                   # PHP 7.1, no mcrypt
    ├── php7.4/                      # PHP 7.4
    ├── php8.1/                      # PHP 8.1
    └── php8.2/                      # PHP 8.2 (default)
```

**wod2 reimplementation:**

wod2 compiles to a single executable (`dist/wod`) with templates bundled
inside. No `/usr/lib/wod/` directory is needed. Users can run `wod install`
to extract bundled templates to `<WOD_HOME>/.template/` for customization.

```
dist/wod                             # Single compiled executable (all templates bundled)
~/wod/.template/                     # User-customized templates (created by wod install)
    └── php8.2/                      # Extracted from bundled templates
        ├── docker-compose.yml.hbs
        └── wp-php-custom/
            ├── Dockerfile.hbs
            └── default.ini
```

### 4.2 Runtime Layout (Per Instance)

```
~/wod/                               # WOD_HOME (configurable)
└── <instance-name>/
    ├── docker-compose.yml           # Generated from template
    ├── .env                         # Port and hostname config (HTTP_PORT, HTTPS_PORT, HOSTNAMES)
    ├── wp-php-custom/
    │   ├── Dockerfile               # Generated from template
    │   ├── default.ini              # PHP config (upload limits)
    │   ├── cert.pem                 # Self-signed TLS certificate
    │   └── cert.key                 # TLS private key
    └── site/                        # WordPress files (bind-mounted)
        ├── wp-config.php
        ├── wp-content/
        │   ├── plugins/
        │   ├── themes/
        │   ├── uploads/
        │   └── ...
        └── ...
```

---

## 5. Configuration & Environment Variables

### 5.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WOD_HOME` | `~/wod` | Root directory where all instances are stored |
| `TEMPLATE_NAME` | `custom` | Which template to use |
| `WORDPRESS_VERSION` | `6.9.1` | WordPress version number |
| `PHP_VERSION` | `8.5` | PHP version number |
| `MYSQL_VERSION` | `5.7` | MySQL version number |
| `HTTP_PORT` | `8000` | HTTP port for the WordPress container |
| `HTTPS_PORT` | `8443` | HTTPS port for the WordPress container |
| `HOSTNAMES` | *(empty)* | Comma-separated hostnames for TLS cert SANs and container `/etc/hosts` |
| `SITEURL` | *(computed)* | Override for the WordPress site URL. When not set, computed as `https://<first-hostname>:<HTTPS_PORT>` if hostnames are configured, otherwise `https://127.0.0.1:<HTTPS_PORT>`. Can be overridden via `--site-url` on restore. |

> **Removed from original:** `SCRIPT_HOME`, `TEMPLATE_DIR`, `WORDPRESS_TAG`,
> and `BACKUP_PREFIX` were specific to the Bash implementation. In wod2,
> templates are bundled in the executable (or customized via
> `<WOD_HOME>/.template/`), computed tags are derived internally, and the
> backup path is passed as a CLI argument only.

### 5.2 Configuration File

wod2 supports a JSON configuration file at `~/.wod/config.json` for persistent
default overrides. The file supports JSONC (JSON with comments). Example:

```jsonc
{
  // Default PHP version for new instances
  "phpVersion": "8.4",
  "httpsPort": 9443
}
```

Any key from the configuration tree can be set in this file (e.g., `wodHome`,
`wordpressVersion`, `phpVersion`, `mysqlVersion`, `templateName`, `httpPort`,
`httpsPort`, `hostnames`, `siteUrl`).

### 5.3 Configuration Precedence (Highest to Lowest)

1. **Command-line arguments** (e.g., `wod create mysite --php-version 8.3`)
2. **Shell environment variables** (e.g., `WORDPRESS_VERSION=5.9 wod create mysite`)
3. **Config file** (`~/.wod/config.json`)
4. **Built-in defaults**

Configuration resolution is handled by the `appyconfig` library, which provides
a `ConfigResolver` with pluggable loaders: `DefaultValueLoader` for built-in
defaults, `JsonLoader` for the config file, `EnvLoader` for environment
variables, and `CmdArgsLoader` for Commander.js CLI argument integration.

Each instance also stores its port and hostname configuration in a `.env` file
within the instance directory. Docker Compose reads this file automatically for
port interpolation in `docker-compose.yml`. The `wod up` command can override
ports, which updates the `.env` file.

---

## 6. CLI Interface

### 6.1 Top-Level Syntax

```
wod [--verbose] <command> [arguments...]
```

If no command is given, help text is printed (via Commander.js).

### 6.2 Available Commands

| Command | Arguments | Options | Description |
|---------|-----------|---------|-------------|
| `create` | `<name> [backup-directory]` | `--http-port`, `--https-port`, `--php-version`, `--wordpress-version`, `--template`, `--hostnames`, `--keep-urls` | Create a new WordPress instance |
| `ls` | *(none)* | | List all instances with status |
| `up` | `<name>` | `--http-port`, `--https-port` | Start a stopped instance |
| `down` | `<name>` | | Stop a running instance |
| `rm` | `<name>` | | Remove an instance completely |
| `restore` | `<name> <backup-directory>` | `--keep-urls`, `--site-url` | Restore backup into existing instance |
| `update` | `<name>` | `--php-version`, `--wordpress-version`, `--template`, `--hostnames` | Update instance with new versions |
| `install` | *(none)* | | Extract bundled templates to `<WOD_HOME>/.template/` for customization |
| `wp` | `<name> <wp-cli-command...>` | | Run wp-cli command on instance |

The global `--verbose` flag causes all Docker commands and their output to be
printed to stderr.

### 6.3 Command Dispatch Mechanism

wod2 uses **Commander.js** for CLI routing. The `createProgram()` function in
`src/cli/cli.ts` creates a `Command` instance and registers each subcommand
with its own argument definitions, option definitions, and action handler.

Commander.js handles:
- Argument and option parsing
- Help text generation (via `--help` on any command)
- Version display (via `--version`)
- Unknown command errors

Each action handler resolves configuration (via `resolveConfig()` and
`resolveConfigForCreate()`), instantiates dependencies (`BunProcessRunner`,
`RealFilesystem`), and delegates to the corresponding command module.

---

## 7. Command Specifications

### 7.1 `wod create <name> [backup-directory]`

**Purpose:** Create a new WordPress Docker instance.

**Arguments:**
- `name` (required): Unique name for the instance
- `backup-directory` (optional): Path to directory containing backup archives

**Options:**
- `--http-port <port>`: HTTP port (default: 8000)
- `--https-port <port>`: HTTPS port (default: 8443)
- `--php-version <version>`: PHP version (default: 8.5)
- `--wordpress-version <version>`: WordPress version (default: 6.9.1)
- `--template <name>`: Template name (default: custom)
- `--hostnames <hostnames>`: Comma-separated hostnames for TLS cert SANs and container `/etc/hosts`
- `--keep-urls`: Keep original siteurl and home from backup (skip URL rewrite)

**Algorithm:**

1. Validate instance name (no slashes, must not start with `.`).
2. Resolve configuration from CLI options, environment variables, and defaults.
3. **Prerequisite checks** (all must pass or exit with error):
   a. Target directory must not already exist.
   b. No Docker container with name `<name>-wordpress-*` must exist (running
      or stopped).
   c. No Docker container with name `<name>-db-*` must exist (running or
      stopped).
   d. No Docker volume named `<name>_db_data` must exist.
   e. If `backup-directory` specified, it must be a valid directory.
4. Resolve the template source (user-customized `<WOD_HOME>/.template/<name>/`
   or bundled) and render template files to the instance directory using
   Handlebars (see Section 9 for details). This produces the final
   `docker-compose.yml`, `Dockerfile`, and `default.ini` with the correct
   version strings.
5. Write `.env` file with `HTTP_PORT`, `HTTPS_PORT`, and `HOSTNAMES` (if any).
6. Generate self-signed TLS certificate via `openssl` with Subject Alternative
   Names (SANs) for `localhost` plus any configured hostnames.
7. Run `docker compose up --build -d`.
8. Sleep 10 seconds (wait for database initialization).
9. Install WordPress core:
   ```
   wp core install --url=<SITEURL> --title="Testing WordPress"
       --admin_user="admin" --admin_email="admin@127.0.0.1"
   ```
   The admin password is auto-generated by wp-cli and extracted from stdout.
10. Set up pretty permalinks via `wp eval`:
    ```php
    global $is_apache, $wp_rewrite;
    $is_apache = true;
    $wp_rewrite->set_permalink_structure('/%postname%/');
    flush_rewrite_rules(true);
    ```
    This uses `wp eval` instead of `wp rewrite` commands because the wp-cli
    sidecar container cannot detect Apache's mod_rewrite. Setting `$is_apache`
    ensures WordPress writes `.htaccess`.
11. If `backup-directory` is set:
    a. Run `restore` (see §7.6).
    b. Unless `--keep-urls` was specified, update site URL and home URL to
       the computed `SITEURL`.
12. Print admin password and "Website ready at `<SITEURL>`".

**Exit codes:**
- 0: Success
- 1: Validation failure (directory exists, container exists, volume exists,
  invalid backup path)

### 7.2 `wod ls`

**Purpose:** List all managed WOD instances and their status.

**Arguments:** None (exits if any arguments given).

**Algorithm:**

1. List contents of `WOD_HOME` directory. If empty, print "No wod instances
   found." and exit.
2. Check if Docker daemon is running (store result).
3. Print header:
   ```
   d w |
   b p | name
   ====#=========================
   ```
4. For each subdirectory in `WOD_HOME`:
   a. Print database status character:
      - `E` if Docker is not running
      - `*` if container `<name>-db-*` is running
      - `.` otherwise
   b. Print WordPress status character (same logic with `<name>-wordpress-*`).
   c. If both containers are running:
      - Query `wp option get siteurl`
      - Print `| <name> at <siteurl>`
   d. Else print `| <name>`

**Output format example:**
```
d w |
b p | name
====#=========================
* * | staging-b at https://127.0.0.1:8443
. . | old-site
```

**Column meanings:**
- `d`/`b` = database status: `*` running, `.` stopped, `E` Docker not running
- `w`/`p` = WordPress status: same encoding

### 7.3 `wod up <name>`

**Purpose:** Start a stopped WordPress instance.

**Arguments:**
- `name` (required): Instance name

**Options:**
- `--http-port <port>`: HTTP port (overrides `.env`)
- `--https-port <port>`: HTTPS port (overrides `.env`)

**Algorithm:**

1. Validate instance name.
2. Verify instance directory exists.
3. If port overrides were specified, write new `.env` file with the updated ports.
4. Run `docker compose up -d`.
5. If successful, query and display site URL via `wp option get siteurl`.
6. Print "Website ready at `<SITEURL>`".

**Exit codes:** Passes through the exit code from `docker compose up`.

### 7.4 `wod down <name>`

**Purpose:** Stop a running WordPress instance.

**Arguments:**
- `name` (required): Instance name

**Algorithm:**

1. Validate instance name.
2. Verify instance directory exists.
3. Run `docker compose down`.

**Exit codes:** Passes through the exit code from `docker compose down`.

### 7.5 `wod rm <name>`

**Purpose:** Completely remove an instance (containers, files, volume).

**Arguments:**
- `name` (required): Instance name

**Algorithm:**

1. Validate instance name.
2. Verify instance directory exists.
3. Print "Removing `<name>`".
4. Acquire sudo credentials (`sudo -v`).
5. If `docker-compose.yml` exists in instance directory, run `docker compose down`.
6. If instance directory exists, run `sudo rm -rf <directory>`.
7. Query for Docker volume named `<name>_db_data`; if it exists, run
   `docker volume rm <volume_name>`.

**Notes:**
- Requires sudo because site files are owned by www-data (UID 33).
- The volume lookup uses `docker volume ls -qf "name=<name>_db_data"`.

### 7.6 `wod restore <name> <backup-directory>`

**Purpose:** Restore WordPress content and database from backup archives.

**Arguments:**
- `name` (required): Instance name (must already exist)
- `backup-directory` (required): Path to directory containing backup files

**Options:**
- `--keep-urls`: Keep original siteurl and home from backup (skip URL rewrite)
- `--site-url <url>`: Override the site URL used for rewriting (default: computed from instance `.env` file as `https://<first-hostname>:<HTTPS_PORT>` or `https://127.0.0.1:<HTTPS_PORT>`)

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

1. Validate instance name.
2. Validate instance directory exists.
3. Validate backup directory exists.
4. **Restore content archives** -- for each content type in order:
   `plugins`, `themes`, `uploads`, `others`:
   a. If no matching zip files found, print warning and skip.
   b. If the `site/wp-content/<type>` directory exists, delete it
      (`sudo rm -rf`).
   c. For each zip file matching `backup*-<type>*.zip` in the backup directory:
      - Extract to `site/wp-content/` using `sudo unzip -od site/wp-content`.
   d. Note: The content type may be split across multiple zip files (e.g.,
      `backup_2024-01-01-uploads.zip`, `backup_2024-01-01-uploads2.zip`).
5. **Fix file permissions:**
   ```
   sudo chown -R www-data:www-data site/wp-content
   ```
6. **Restore database:**
   a. Look for `backup*-db.gz` in the backup directory.
   b. If not found, fall back to `*.sql.gz`.
   c. If still not found, print warning and skip database restore.
   d. **Extract UpdraftPlus header comments:**
      - Decompress the `.gz` file in-process using Node.js `zlib` streams.
      - Read the first 50 lines of the decompressed content.
      - Parse lines starting with `#` for key-value pairs in format
        `# Key: Value`.
      - Key extracted variable: `table_prefix`.
   e. **Update table prefix** (if found in header):
      - Read `site/wp-config.php` via `sudo cat`.
      - Replace the `$table_prefix = '...'` value in TypeScript (handles
        both the static format and Docker's `getenv_docker()` format).
      - Write back via `sudo tee`.
   f. **Import database** with SQL compatibility fix:
      - Create a streaming pipeline: `fs.createReadStream` → `zlib.createGunzip()`
        → TypeScript transform stream → `docker run ... wp db import -` via stdin.
      - The transform stream applies two rules line-by-line:
        - After lines starting with `# -----`, insert a SQL mode directive:
          ```sql
          /*!40101 SET sql_mode='ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */;
          ```
        - Remove lines starting with `/*M!` (MariaDB-specific directives).
      - The transformed SQL is piped as a `ReadableStream` to `wp db import -`.
7. **Rewrite site URL** (unless `--keep-urls` was specified):
   - Set `siteurl` and `home` options via wp-cli to the resolved site URL.

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
1. Decompress the `.gz` file in-process using Node.js `zlib.createGunzip()`.
2. Read the first 50 lines.
3. Extract lines starting with `#` until the first non-comment line.
4. Match `# Table prefix: <value>` to extract the table prefix.

### 7.7 `wod wp <name> <wp-cli-command...>`

**Purpose:** Execute wp-cli commands against a running WOD instance.

**Arguments:**
- `name` (required): Instance name
- All remaining arguments are passed to wp-cli

**Algorithm:**

1. Validate instance name.
2. Look up the running WordPress container:
   a. Search for container with name matching `<name>-wordpress`.
   b. If not found, try again with hyphens stripped from the name (for older
      Docker versions that stripped hyphens from project names).
   c. If still not found, print error and exit.
3. Determine input mode:
   - If stdin is a TTY: use `-it` flags for Docker (interactive + pseudo-TTY).
   - If stdin is a pipe: use `-i` flag only (interactive, no TTY).
4. Execute wp-cli via Docker:
   ```
   docker run <input-flags> --rm \
       --env <WORDPRESS_*=...> ... \
       --volumes-from <container> \
       --network container:<container> \
       --user 33:33 \
       wordpress:cli wp <wp-cli-args...>
   ```

**Key Docker flags explained:**
- `--env ...`: Passes `WORDPRESS_*` environment variables extracted from the
  running container (with baseline defaults for DB credentials). This ensures
  wp-cli has the correct database connection settings.
- `--volumes-from`: Mounts the same volumes as the WordPress container, giving
  wp-cli access to the site files.
- `--network container:<container>`: Shares the network namespace, allowing
  wp-cli to reach the database container via the same hostname (`db`).
- `--user 33:33`: Runs as UID/GID 33 (www-data) to match file ownership in
  the WordPress container. This is a workaround because the wp-cli and
  WordPress containers may have different UID/GID mappings for www-data.

### 7.8 `wod update <name>`

**Purpose:** Update an existing instance with new PHP/WordPress versions,
template, or hostnames.

**Arguments:**
- `name` (required): Instance name

**Options:**
- `--php-version <version>`: PHP version
- `--wordpress-version <version>`: WordPress version
- `--template <name>`: Template name
- `--hostnames <hostnames>`: Comma-separated hostnames for TLS cert SANs

**Algorithm:**

1. Validate instance name.
2. Verify instance directory exists.
3. If `--hostnames` is not specified, read existing hostnames from the instance
   `.env` file to preserve them.
4. Resolve configuration from CLI options, environment variables, and defaults.
5. Run `docker compose down` to stop containers.
6. Re-render template files (Dockerfile, docker-compose.yml, etc.) with new
   version variables via Handlebars.
7. Regenerate self-signed TLS certificate with SANs for `localhost` plus
   configured hostnames.
8. Run `docker compose up --build -d` to rebuild the image and start containers.
9. Print "Website ready at `<SITEURL>`".

**Exit codes:**
- 0: Success
- 1: Instance directory does not exist
- (other): Passed through from Docker commands

---

## 8. Shared Utility Functions

wod2 organizes shared functionality into TypeScript modules with interface-based
abstractions for testability.

### `ProcessRunner` interface (`src/docker/process-runner.ts`)

Abstracts external process execution. Two methods:

- `run(command, options?)`: Synchronous execution via `Bun.spawnSync()`. Returns
  `{ exitCode, stdout, stderr }`.
- `runAsync(command, options?)`: Asynchronous execution via `Bun.spawn()` with
  support for streaming stdin (used for database import). Returns a Promise.

The `BunProcessRunner` implementation accepts a `verbose` option that logs all
commands and their output to stderr when enabled.

### `Filesystem` interface (`src/utils/filesystem.ts`)

Abstracts filesystem operations for testability:

- `listSubdirectories(path)`: List subdirectory names in a directory
- `ensureDirectory(path)`: Create directory and parents
- `isDirectory(path)`: Check if path is a directory
- `writeFile(path, content)`: Write file content
- `readFile(path)`: Read file content as string
- `fileExists(path)`: Check if path is a file
- `globFiles(dir, pattern)`: Match filenames against a glob pattern
- `listFilesRecursive(path)`: List all files recursively

The `RealFilesystem` implementation uses Node.js `fs` functions.

### Docker utilities (`src/docker/docker.ts`)

- `dockerIsRunning(runner)`: Runs `docker version` and returns true if exit
  code is 0.
- `containerIsRunning(runner, name, service)`: Checks if a container matching
  `<name>-<service>-*` is running.
- `containerExists(runner, name, service)`: Same but includes stopped containers
  (uses `-a` flag).
- `volumeExists(runner, volumeName)`: Checks if a named Docker volume exists.
- `getWordPressEnvVars(runner, containerId)`: Extracts `WORDPRESS_*` env vars
  from a running container, merged with baseline defaults for DB credentials.
- `querySiteUrl(runner, instanceName)`: Finds the running WordPress container
  and queries `wp option get siteurl` via the wp-cli sidecar.

### Configuration (`src/config/config.ts`, `src/config/create-config.ts`)

- `resolveConfig(overrides?)`: Returns `WodConfig` with `wodHome` resolved from
  overrides, `WOD_HOME` env var, config file (`~/.wod/config.json`), or `~/wod`
  default. Uses `appyconfig` for unified config resolution.
- `resolveConfigForCreate(overrides?)`: Returns `CreateConfig` with version numbers,
  ports, hostnames, template name, and computed site URL — resolved from
  overrides, CLI args (via Commander.js integration), env vars, config file, and
  defaults. Uses `appyconfig` with `CmdArgsLoader` for automatic CLI arg capture.
- `targetDir(config, name)`: Returns full path `<wodHome>/<name>`.

---

## 9. Docker Template System

### 9.1 Overview

> **Historical note:** The original Bash implementation stored templates as
> static files under `/usr/lib/wod/template/` and patched version strings
> at create time using `sed` regex replacements. The wod2 reimplementation
> replaces this with **Handlebars templates** (`.hbs` files) that are compiled
> in-process, eliminating the need for external text-processing utilities.

Templates are stored as actual files in the `template/` directory at the
project root. Files with a `.hbs` extension are processed through Handlebars
at create time; all other files are copied as-is.

### 9.2 Template Structure

Each template is a directory under `template/` containing:

```
template/
└── php8.2/
    ├── docker-compose.yml.hbs       # Handlebars template
    └── wp-php-custom/
        ├── Dockerfile.hbs           # Handlebars template
        └── default.ini              # Copied as-is (no .hbs extension)
```

### 9.3 Template Variables

Handlebars templates receive a `TemplateVars` object with the following fields:

| Variable | Example Value | Source |
|----------|--------------|--------|
| `wordpressVersion` | `6.9.1` | `CreateConfig.wordpressVersion` |
| `phpVersion` | `8.2` | `CreateConfig.phpVersion` |
| `mysqlVersion` | `5.7` | `CreateConfig.mysqlVersion` |
| `wordpressTag` | `6.9.1-php8.5-apache` | Computed: `<WP>-php<PHP>-apache` |
| `wordpressCustomImageTag` | `6.9.1-php8.5-custom` | Computed: `<WP>-php<PHP>-custom` |
| `phpGdLegacy` | `false` | `true` for PHP < 7.4 (old-style `--with-freetype-dir` GD flags) |
| `phpAvifSupported` | `true` | `true` for PHP >= 8.1 (adds `--with-avif` to GD configure) |
| `phpMcryptAvailable` | `false` | `true` for PHP < 7.2 (installs mcrypt extension) |
| `hostnames` | `["mysite.local"]` | `CreateConfig.hostnames` (comma-separated CLI input → array) |

### 9.4 Template Bundling and Resolution

Templates are bundled into the compiled executable via TypeScript
`import ... with { type: "text" }` statements in `src/templates/bundled-templates.ts`.
This means templates are embedded at compile time and available without external files.

**Resolution order** (checked by `resolveTemplateSource()`):

1. **User-customized template:** `<WOD_HOME>/.template/<templateName>/` — if
   this directory exists, its files are used instead of the bundled template.
2. **Bundled template:** Compiled into the executable from `template/`.
3. If neither is found, an error is thrown.

The `wod install` command extracts all bundled templates to
`<WOD_HOME>/.template/` so users can customize them.

### 9.5 Available Templates

| Template | Base Image | Notes |
|----------|-----------|-------|
| `custom` | `php:X.Y-apache` | **Default.** Builds from bare PHP image, downloads WordPress from wordpress.org. Supports any PHP + WordPress version combination. Uses Handlebars conditionals for PHP version differences (GD flags, avif, mcrypt). |
| `default` | `wordpress:X-phpY-apache` | PHP 7.1 + mcrypt (original WOD default) |
| `no-mcrypt` | `wordpress:X-phpY-apache` | PHP 7.1, no mcrypt |
| `php7.4` | `wordpress:X-phpY-apache` | PHP 7.4 |
| `php8.1` | `wordpress:X-phpY-apache` | PHP 8.1 |
| `php8.2` | `wordpress:X-phpY-apache` | PHP 8.2 |

> The `custom` template is now the default. It bundles the official WordPress
> Docker entrypoint script and wp-config template (Apache-2.0 licensed from
> `docker-library/wordpress`) and handles PHP version differences via Handlebars
> conditionals. The legacy templates (`default`, `no-mcrypt`, `php7.4`, `php8.1`,
> `php8.2`) remain available for backward compatibility and use the official
> `wordpress` Docker Hub images as their base.

### 9.6 docker-compose.yml.hbs Template

The template defines two services:

```yaml
services:
   db:
      image: mysql:{{mysqlVersion}}
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
      image: wordpress:{{wordpressCustomImageTag}}
      volumes:
         - ./site:/var/www/html
      ports:
         - "${HTTP_PORT:-8000}:80"
         - "${HTTPS_PORT:-8443}:443"
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
- Ports are configurable via `.env` file: HTTP defaults to 8000, HTTPS to 8443.
- SSL is supported via self-signed certificates generated at create time.
- Database credentials are hardcoded (`wordpress`/`wordpress`). This is
  acceptable because these are local development instances only.

### 9.7 Dockerfile.hbs Template

The Dockerfile builds a custom WordPress image. The `custom` template builds
from `php:X.Y-apache` and installs WordPress from wordpress.org, while legacy
templates build from `wordpress:X-phpY-apache`. All templates include:

- PHP extension installation (GD, imagick, bcmath, etc.)
- Upload limit configuration via `default.ini`
- Apache `AllowOverride All` for `.htaccess` support
- Self-signed SSL certificate for HTTPS

The `custom` template additionally uses Handlebars conditionals to handle
PHP version differences:
- **GD configure flags:** Legacy (`--with-freetype-dir`) for PHP < 7.4, modern
  (`--with-freetype`) for PHP >= 7.4, with `--with-avif` added for PHP >= 8.1
- **mcrypt extension:** Only installed for PHP < 7.2
- **AVIF support:** `libavif-dev` package only installed for PHP >= 8.1

### 9.8 default.ini

```ini
upload_max_filesize=100M
post_max_size = 100M
```

### 9.9 Template Processing

During `wod create`, the template engine:

1. Resolves the template source (user-customized or bundled).
2. Iterates over all files in the template.
3. For each `.hbs` file: compiles with Handlebars using `TemplateVars`, writes
   the output without the `.hbs` extension (e.g., `docker-compose.yml.hbs` →
   `docker-compose.yml`).
4. For all other files: copies content as-is.
5. Creates parent directories as needed.

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
  container (merged with baseline DB credential defaults)

This means wp-cli has full access to the WordPress files and can communicate
with the database, but runs in its own ephemeral container that is removed
after each command (`--rm`).

### 11.2 TTY Detection

When stdin is a TTY (interactive shell), Docker is invoked with `-it`.
When stdin is a pipe (e.g., `echo "SELECT 1" | wod wp mysite db query`),
Docker is invoked with `-i` only (no pseudo-TTY).

---

## 12. Installation & Packaging

wod2 compiles to a single self-contained executable using Bun's ahead-of-time
compiler:

```bash
bun build --compile --target=bun-linux-x64 src/index.ts --outfile dist/wod
```

The resulting `dist/wod` binary includes the Bun runtime, all TypeScript code,
all npm dependencies, and all Handlebars templates (embedded at compile time
via `import ... with { type: "text" }` in `src/templates/bundled-templates.ts`).

No Makefile, no `/usr/lib/wod/` directory, and no separate template files are
needed. Users can simply copy `dist/wod` to a directory on their `PATH`.

---

## 13. Use Cases & Workflows

### 13.1 Fresh WordPress Development Site

```
wod create devsite
# → Creates a fresh WordPress 6.9.1 instance at https://127.0.0.1:8443
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
wod wp testsite search-replace https://example.com https://127.0.0.1:8443
wod wp testsite option set siteurl https://127.0.0.1:8443
wod wp testsite option set home https://127.0.0.1:8443
```

### 13.4 Test with Different PHP Versions

```
# Using CLI flags (recommended)
wod create legacy-test --php-version 7.4 --wordpress-version 5.9
wod create modern-test --php-version 8.3 --wordpress-version 6.9.1

# Using environment variables
PHP_VERSION=7.4 WORDPRESS_VERSION=5.9 wod create legacy-test

# Using a legacy template instead of the custom template
wod create compat-test --template php8.2
```

### 13.5 Manage Multiple Sites

```
wod ls
# d w |
# b p | name
# ====#=========================
# * * | staging-b at https://127.0.0.1:8443
# . . | old-site
# * * | devsite at https://mysite.local:9443

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

### 13.7 Custom Ports and Hostnames

```
# Run on non-default ports
wod create mysite --http-port 9000 --https-port 9443

# Configure a custom hostname (added to TLS cert SANs)
wod create mysite --hostnames mysite.local,mysite.test

# Override ports when starting an existing instance
wod up mysite --http-port 9000 --https-port 9443
```

### 13.8 Update an Instance

```
# Upgrade PHP version
wod update mysite --php-version 8.3

# Change WordPress version and PHP version
wod update mysite --wordpress-version 6.8 --php-version 8.2

# Update hostnames (regenerates TLS cert)
wod update mysite --hostnames newhost.local
```

---

## 14. Known Limitations & Future Work

These items are documented in `TODO.md` and observed in the code:

1. **No image tag validation:** `wod create` does not verify that the
   computed WordPress or MySQL Docker image tag actually exists before
   attempting to build/pull.

2. **Port conflicts with multiple instances:** Ports are configurable via
   `--http-port` and `--https-port` flags, but users must manually choose
   non-conflicting ports when running multiple instances simultaneously.

3. **Container name matching with hyphens:** Instance names containing
   hyphens may cause issues with Docker container lookups due to historical
   Docker behavior of stripping hyphens from project names. The code has a
   workaround but it may not cover all edge cases.

4. **Instance names with dots:** Names starting with `.` are rejected with a
   validation error. Names containing dots elsewhere may still cause container
   name lookup failures.

5. **No WordPress version auto-detection:** When restoring from backup,
   WOD cannot automatically determine the original WordPress version from
   the database dump.

6. **Hardcoded database credentials:** All instances use `wordpress` /
   `wordpress` for MySQL credentials. This is acceptable for local
   development but would need to change for any shared use.

7. **sudo requirement:** File operations on `site/wp-content/` require sudo
   because the files are owned by `www-data` (UID 33) inside the container.

8. **.htaccess handling:** The restore process may overwrite existing
   `.htaccess` files without backup.

9. **Template documentation:** The template system (multiple PHP version
   templates) is not yet documented in user-facing help.

10. ~~**Config file support:**~~ Implemented. A JSON config file at
    `~/.wod/config.json` supports persistent default overrides via the
    `appyconfig` library.

12. **jsonc-parser UMD bundling workaround:** The `appyconfig` library
    depends on `jsonc-parser`, whose UMD build uses dynamic
    `require("./impl/...")` calls that Bun's bundler cannot statically
    resolve, breaking `--compile` builds. A prebuild script
    (`scripts/patch-jsonc-parser.ts`) patches jsonc-parser's
    `package.json` to use its ESM entry point instead. TODO: replace
    `jsonc-parser` with a bundler-friendly JSONC parser (or configure
    `appyconfig` without it) to eliminate this workaround.

11. **wp CWD auto-detection:** The original Bash `wp` shell function could
    auto-detect the instance name when the current directory was inside
    `WOD_HOME`. In wod2, the instance name is always required as the first
    argument to `wod wp`. A future enhancement could restore CWD-based
    detection and system wp-cli fallback.

---

## Appendix A: Complete Command Reference

```
wod                                 # Show help
wod --help                          # Show help
wod <command> --help                # Show help for a command
wod create <name> [backup-dir]     # Create new instance
wod ls                              # List all instances
wod up <name>                       # Start instance
wod down <name>                     # Stop instance
wod rm <name>                       # Remove instance
wod restore <name> <backup-dir>    # Restore backup
wod update <name>                   # Update instance versions
wod install                         # Extract bundled templates for customization
wod wp <name> <command...>          # Run wp-cli command
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
