# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/artifact-scanner/package.json apps/artifact-scanner/project.json apps/artifact-scanner/tsconfig.json apps/artifact-scanner/
RUN npm ci
COPY apps/artifact-scanner/src apps/artifact-scanner/src
RUN npx nx run artifact-scanner:build

FROM clamav/clamav:1.5.2@sha256:1b6443c4a9b79df4f7c71da8e0c1ea36b7995858ea24c45b2a9e90bfa0aa0f3c AS definitions

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=definitions /usr/bin/clamscan /usr/local/bin/clamscan
COPY --from=definitions /var/lib/clamav /opt/opencrane/clamav-db
COPY package.json package-lock.json ./
COPY apps/artifact-scanner/package.json apps/artifact-scanner/
RUN npm ci --omit=dev --workspace=apps/artifact-scanner
COPY --from=build /app/dist/apps/artifact-scanner dist/apps/artifact-scanner
USER 65532:65532
CMD ["node", "dist/apps/artifact-scanner/index.js"]
