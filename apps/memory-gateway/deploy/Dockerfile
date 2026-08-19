# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/memory-gateway/package.json apps/memory-gateway/project.json apps/memory-gateway/tsconfig.json apps/memory-gateway/
# The cache mount keeps npm's download cache out of the image layers and shares it
# between stages, so the runtime-stage install reuses the packages this stage fetched.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/memory-gateway/src apps/memory-gateway/src
RUN npx nx run memory-gateway:build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/memory-gateway/package.json apps/memory-gateway/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace=apps/memory-gateway
# Shared conversation contracts keep these packages external in the compiled gateway bundle.
# Resolve their public runtime entrypoints now so a production image cannot build without them.
RUN node --input-type=module --eval \
    "await Promise.all([import('ajv'), import('@a2ui/web_core/v0_8'), import('@ag-ui/core'), import('@opentelemetry/core')])"

COPY --from=build /app/dist/apps/memory-gateway dist/apps/memory-gateway
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/apps/memory-gateway/index.js"]
