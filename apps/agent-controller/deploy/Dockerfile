# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/agent-controller/package.json apps/agent-controller/project.json apps/agent-controller/tsconfig.json apps/agent-controller/
RUN npm ci

COPY apps/agent-controller/src apps/agent-controller/src
RUN npx nx run agent-controller:build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/agent-controller/package.json apps/agent-controller/
RUN npm ci --omit=dev --workspace=apps/agent-controller
# The build leaves process dependencies external so Node can load their supported runtime entrypoints.
# Resolve every emitted package entrypoint now so the image cannot publish with a missing module.
RUN node --input-type=module --eval \
    "await Promise.all([import('@a2ui/web_core/v0_8'), import('@kubernetes/client-node'), import('@noble/hashes/sha2.js'), import('@noble/hashes/utils.js'), import('@opentelemetry/api'), import('@opentelemetry/auto-instrumentations-node'), import('@opentelemetry/core'), import('@opentelemetry/exporter-trace-otlp-proto'), import('@opentelemetry/sdk-node'), import('absurd-sdk'), import('ajv'), import('openapi-fetch'), import('pg'), import('pino'), import('zod')])"

COPY --from=build /app/dist/apps/agent-controller dist/apps/agent-controller

USER 65532:65532
CMD ["node", "dist/apps/agent-controller/index.js"]
