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

COPY --from=build /app/dist/apps/agent-controller dist/apps/agent-controller

USER 65532:65532
CMD ["node", "dist/apps/agent-controller/index.js"]
