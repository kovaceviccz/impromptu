FROM node:24-alpine@sha256:760e44b64c78674d9c79fa32e63c0ba8f817f79791e1aa32e07669bb0bfeaeaa AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY .husky/install.mjs .husky/install.mjs
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine@sha256:760e44b64c78674d9c79fa32e63c0ba8f817f79791e1aa32e07669bb0bfeaeaa AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

LABEL org.opencontainers.image.source="https://github.com/kovaceviccz/impromptu"

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY .husky/install.mjs .husky/install.mjs
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/apps/web/build/client apps/web/build/client

# Named volumes inherit this ownership, so the non-root user can write the database.
RUN mkdir -p /var/lib/impromptu && chown node:node /var/lib/impromptu

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/api/dist/server.js"]
