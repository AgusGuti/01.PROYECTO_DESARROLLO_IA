# syntax=docker/dockerfile:1
# Build context: the repository root (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-contracts packages/api-contracts
RUN npm ci --workspace @print3d/web --include-workspace-root --ignore-scripts \
  && npm rebuild esbuild
COPY apps/web apps/web
RUN npm run build --workspace @print3d/web

# Unprivileged nginx: listens on 8080 and does not run as root.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
