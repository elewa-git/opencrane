# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/channel-proxy/package.json apps/channel-proxy/project.json apps/channel-proxy/tsconfig.json apps/channel-proxy/
# The cache mount keeps npm's download cache out of the image layers and shares it
# between stages, so the runtime-stage install reuses the packages this stage fetched.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/channel-proxy/src apps/channel-proxy/src
RUN npx nx run channel-proxy:build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/channel-proxy/package.json apps/channel-proxy/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace=apps/channel-proxy

COPY --from=build /app/dist/apps/channel-proxy dist/apps/channel-proxy

# Kubernetes cannot prove that a named image user satisfies runAsNonRoot. The upstream `node` user
# is UID/GID 1000, so pin its numeric identity in the image contract.
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/apps/channel-proxy/index.js"]
