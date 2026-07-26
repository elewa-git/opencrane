# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/artifact-preprocessor/package.json apps/artifact-preprocessor/project.json apps/artifact-preprocessor/tsconfig.json apps/artifact-preprocessor/
RUN npm ci

COPY apps/artifact-preprocessor/src apps/artifact-preprocessor/src
RUN npx nx run artifact-preprocessor:build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install --no-install-recommends -y poppler-utils && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/artifact-preprocessor/package.json apps/artifact-preprocessor/
RUN npm ci --omit=dev --workspace=apps/artifact-preprocessor

COPY --from=build /app/dist/apps/artifact-preprocessor dist/apps/artifact-preprocessor

USER 65532:65532
CMD ["node", "dist/apps/artifact-preprocessor/index.js"]
