# NOTE: build context is the REPO ROOT (e.g. `docker build -f apps/opencrane-ui/deploy/Dockerfile .`),
# not the app dir — required so the Angular app's @opencrane/* library path aliases
# (libs/frontend/*, libs/backend/*, libs/contracts, …) resolve exactly as they do locally.
#
# Serves the org-admin console (apps/opencrane-ui) as a chart-native SPA — the
# apps/_infra/deploy-k8s chart's opencrane-ui-spa Deployment/Service
# (controlPlaneSpa.enabled) and Ingress path-split route `/` here, `/api` + `/gateway`
# to the opencrane-ui backend. Replaces WeOwnAI's externally-applied
# platform/Dockerfile.opencrane-ui + deploy-org-frontend.sh (elewa-git/opencrane#152).

# Build stage
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.frontend.json nx.json ./
# All workspace libs (frontend/*, backend/*/main, contracts, state/*) come in wholesale so
# the image never needs editing when a lib is added; the root .dockerignore keeps
# node_modules/dist out of the context. The Angular app types against @opencrane/contracts'
# ALREADY-GENERATED src/generated/api.ts (committed source, generated intra-repo from the
# dist OpenAPI artifact) — no OpenAPI spec or codegen step needed here.
COPY libs libs
COPY apps/opencrane-ui apps/opencrane-ui
# npm workspaces install: root package.json's "workspaces" field includes apps/* and website
RUN npm ci

RUN npx nx build opencrane-ui

# Runtime stage — static SPA served by an unprivileged, non-root nginx.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY apps/opencrane-ui/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/opencrane-ui/browser /usr/share/nginx/html

EXPOSE 8080
