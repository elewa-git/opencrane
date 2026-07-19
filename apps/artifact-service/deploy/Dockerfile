# Build context is the repository root so workspace aliases resolve.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json nx.json ./
COPY libs libs
COPY apps/artifact-service/package.json apps/artifact-service/project.json apps/artifact-service/tsconfig.json apps/artifact-service/
RUN npm ci

COPY apps/artifact-service/src apps/artifact-service/src
RUN npx nx run artifact-service:build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/artifact-service/package.json apps/artifact-service/
RUN npm ci --omit=dev --workspace=apps/artifact-service

COPY --from=build /app/dist/apps/artifact-service dist/apps/artifact-service

USER node
EXPOSE 8080
CMD ["node", "dist/apps/artifact-service/index.js"]
