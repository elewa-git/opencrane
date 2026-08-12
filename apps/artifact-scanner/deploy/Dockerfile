# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/artifact-scanner/package.json apps/artifact-scanner/project.json apps/artifact-scanner/tsconfig.json apps/artifact-scanner/
RUN npm ci
COPY apps/artifact-scanner/src apps/artifact-scanner/src
RUN npx nx run artifact-scanner:build

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime-dependencies
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/artifact-scanner/package.json apps/artifact-scanner/
RUN npm ci --omit=dev --workspace=apps/artifact-scanner

# Keep the pinned scanner executable, its dynamic libraries, and its offline definitions together.
FROM clamav/clamav-debian:1.5.2@sha256:14e2e0805c6a5ff6728ea591c05565e0f0954d93e8701919012c3a8c44e20674
WORKDIR /app
ENV NODE_ENV=production
COPY --from=runtime-dependencies /usr/local /usr/local
COPY --from=runtime-dependencies /app/node_modules node_modules
COPY --from=build /app/dist/apps/artifact-scanner dist/apps/artifact-scanner
# The runtime has no root privileges; make the immutable bundled signatures traversable and readable.
RUN chmod -R a+rX /var/lib/clamav
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/apps/artifact-scanner/index.js"]
