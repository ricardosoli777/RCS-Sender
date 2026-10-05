FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/main.js"]

# Swarm target keeps API/web on loopback inside one supervised application task.
FROM caddy:2 AS swarm-edge
FROM runtime AS swarm
COPY --from=swarm-edge /usr/bin/caddy /usr/local/bin/caddy
CMD ["node", "--env-file=/run/secrets/rcs_runtime_env", "ops/swarm-supervisor.mjs"]
