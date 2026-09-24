# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/mcp-file-generator/package.json apps/mcp-file-generator/project.json apps/mcp-file-generator/tsconfig.json apps/mcp-file-generator/
RUN npm ci
COPY apps/mcp-file-generator/src apps/mcp-file-generator/src
RUN npx nx run mcp-file-generator:build

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/mcp-file-generator/package.json apps/mcp-file-generator/
RUN npm ci --omit=dev --workspace=apps/mcp-file-generator
COPY --from=build /app/dist/apps/mcp-file-generator dist/apps/mcp-file-generator
USER 65532:65532
ENTRYPOINT ["node"]
CMD ["dist/apps/mcp-file-generator/index.js"]
