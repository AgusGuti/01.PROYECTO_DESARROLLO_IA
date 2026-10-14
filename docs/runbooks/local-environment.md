# Runbook: local environment

Run every command from the repository root. When something is wrong, start with
`npm run doctor`: it checks each piece and prints the fix.

## First time on a machine

1. Install the four host prerequisites: Node.js 22 (22.22.3 or newer), Python 3.12,
   Docker Desktop, Git.
2. `npm run bootstrap`
   Installs Node packages, creates `apps/assistant/.venv`, downloads `gitleaks` and `gh` into
   `.tools/` (checksums verified), creates `.env` from `.env.example`, starts MongoDB.
3. `npm run doctor` should end with "Ready".
4. For the chat assistant: start Ollama and `ollama pull qwen3:8b` (about 5 GB).

## Daily use

| Do                          | Command                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| Start MongoDB               | `npm run db:up`                                                      |
| Start everything            | `npm run dev` → web http://localhost:4200, API http://127.0.0.1:3000 |
| Start one part              | `npm run dev:api`, `npm run dev:web`, `npm run dev:assistant`        |
| Open a MongoDB shell        | `npm run db:shell`                                                   |
| Check before stopping work  | `npm run verify:quick`                                               |
| Check before a pull request | `npm run verify`                                                     |
| Stop MongoDB (data is kept) | `npm run db:down`                                                    |

## Common problems

| Symptom                                       | Cause                                                                                    | Fix                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API exits: "cannot connect to MongoDB"        | the container is not running                                                             | start Docker Desktop, then `npm run db:up`                                                         |
| API exits: "Invalid configuration"            | `.env` is missing a value or has a bad one                                               | the message names the variable; compare with `.env.example`                                        |
| API exits: "must be a loopback address"       | `HOST` was changed                                                                       | set `HOST=127.0.0.1` (see EXC-0001)                                                                |
| Port 3000, 4200, 8000 or 27017 already in use | an earlier run is still alive, or another program                                        | PowerShell: `Get-NetTCPConnection -LocalPort 3000 \| Select OwningProcess`, then stop that process |
| Web page says it cannot connect               | the API is not running                                                                   | `npm run dev:api`                                                                                  |
| `npm ci` fails on engine                      | wrong Node version                                                                       | install the version in `.nvmrc`                                                                    |
| `npm install` warns about install scripts     | a new package wants to run a script                                                      | review it, then `npm install-scripts approve <pkg>`; this is a dependency decision                 |
| "not installed in apps/assistant/.venv"       | the Python environment is missing                                                        | `node scripts/bootstrap.mjs --only=python`                                                         |
| Secret scan says gitleaks is missing          | `.tools/` was deleted                                                                    | `node scripts/bootstrap.mjs --only=tools`                                                          |
| A commit is refused                           | on `main`, a guard violation, lint, or a commit message not in Conventional Commits form | read the message; never use `--no-verify`                                                          |
| Assistant answers 503                         | Ollama is not running or the model is not pulled                                         | start Ollama; `ollama pull qwen3:8b`                                                               |
| The first integration test run is slow        | it downloads a MongoDB binary into `node_modules/.cache`                                 | wait; later runs take seconds                                                                      |

## MongoDB data

The data lives in the Docker volume `print3d_mongo-data` and survives restarts and
`npm run db:down`.

**Back up:**

```bash
docker compose exec -T mongo mongodump --db print3d --archive --gzip > backup-print3d.archive.gz
```

**Restore into a scratch database, to prove the backup works** (standard §11.4: an unverified
backup is not a backup):

```bash
docker compose exec -T mongo mongorestore --archive --gzip --nsFrom "print3d.*" --nsTo "print3d_restore_test.*" < backup-print3d.archive.gz
docker compose exec mongo mongosh print3d_restore_test --eval "db.getCollectionNames()"
```

Keep backup files out of the repository.

**Start from an empty database.** This deletes all local data and cannot be undone, so agents
ask before running it:

```bash
docker compose down --volumes
npm run db:up
```

## Running the whole stack in containers

Useful to check the production builds. Stop `npm run dev` first (same ports).

```bash
docker compose --profile full up -d --build
# web: http://localhost:8080   API: http://127.0.0.1:3000   assistant: http://127.0.0.1:8000
docker compose --profile full down
```

The containerised assistant reaches Ollama on the host through `host.docker.internal`.

## Ollama in a container instead of the desktop app

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull qwen3:8b
```

It needs GPU passthrough in Docker Desktop (NVIDIA driver and WSL 2). Do not run it together
with the desktop app: both use port 11434.

## Upgrading

One thing at a time, on its own branch, with `npm run verify` after each:

- **A Node package:** `npm install <pkg>@<version> --save-exact`, read its changelog first.
- **A Python package:** `npm run py -- uv add "<pkg>>=<version>"`.
- **gitleaks or gh:** change the version _and_ the SHA-256 in `scripts/tools.mjs` (copy the hash
  from the publisher's checksum file), then `node scripts/bootstrap.mjs --only=tools`.
- **Node itself:** update `.nvmrc`, `engines` in `package.json`, and the base images in the
  Dockerfiles together.
