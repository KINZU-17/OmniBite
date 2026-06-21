Running e2e tests

This document explains how to run the API e2e tests locally using one of three options:

1) Docker (recommended)

Install Docker (Ubuntu):
```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# from repo root
docker compose up -d
cd apps/api
npm run prisma:generate
npm run test:e2e
```

2) Remote Postgres/Redis

Set env vars to point at an existing Postgres and Redis then run e2e:
```bash
export DATABASE_URL_ADMIN="postgresql://user:pass@host:5432/postgres"
export DATABASE_URL_TEST="postgresql://user:pass@host:5432/omnibite_test"
export DATABASE_URL="postgresql://user:pass@host:5432/omnibite?schema=public"
export REDIS_URL="redis://:password@host:6379"
cd apps/api
npm run prisma:generate
npm run test:e2e
```

3) Embedded Postgres (no Docker) — best-effort

The test bootstrap will attempt to start `embedded-postgres` if no external DB is configured. To opt out, set `USE_EMBEDDED_POSTGRES=false`.

```bash
# let prepare-e2e start embedded-postgres automatically
cd apps/api
npm run prisma:generate
npm run test:e2e

# or opt out
USE_EMBEDDED_POSTGRES=false npm run test:e2e
```

Notes
- e2e setup script is `apps/api/test/prepare-e2e.js`.
- If embedded Postgres fails to start, use Docker or a remote DB.
