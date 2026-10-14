# syntax=docker/dockerfile:1
# Build context: the repository root (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-contracts/package.json packages/api-contracts/
# --ignore-scripts: no install script runs in the image build (standard §8.4).
RUN npm ci --workspace @print3d/api --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build --workspace @print3d/api \
  && npm prune --omit=dev --workspace @print3d/api --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production \
    CONTAINERIZED=true
WORKDIR /app
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/api/package.json package.json
# Run as the unprivileged user that the base image provides.
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "dist/server.js"]
