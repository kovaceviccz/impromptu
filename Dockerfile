FROM node:24-alpine@sha256:760e44b64c78674d9c79fa32e63c0ba8f817f79791e1aa32e07669bb0bfeaeaa

WORKDIR /workspace

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY .husky/install.mjs .husky/install.mjs
RUN npm ci

COPY . .

ENV NODE_OPTIONS=--conditions=development
