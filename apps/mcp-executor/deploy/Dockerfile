# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/mcp-executor/package.json apps/mcp-executor/project.json apps/mcp-executor/tsconfig.json apps/mcp-executor/
RUN npm ci
COPY apps/mcp-executor/src apps/mcp-executor/src
RUN npx nx run mcp-executor:build

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/mcp-executor/package.json apps/mcp-executor/
RUN npm ci --omit=dev --workspace=apps/mcp-executor
COPY --from=build /app/dist/apps/mcp-executor dist/apps/mcp-executor
USER 65532:65532
ENTRYPOINT ["node"]
CMD ["dist/apps/mcp-executor/index.js"]
