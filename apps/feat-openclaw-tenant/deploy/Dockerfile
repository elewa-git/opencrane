# Immutable runtime image for the OpenClaw tenant pod (build context = repo root, per CI).
FROM node:22-bookworm-slim

ARG OPENCLAW_VERSION=2026.6.11
ARG COGNEE_PLUGIN_VERSION=2026.7.9

# curl is required by entrypoint.sh's 30s effective-contract re-pull loop. bookworm-slim ships
# without it, which silently turned that loop into a fleet-wide no-op (the pod never refreshed
# its runtime contract / openclaw.json after boot). Kept minimal: no recommends, apt lists purged.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Runtime code is an image layer, never a startup download or a tenant-PVC payload. Exact package
# versions make a previous-image rollback restore the complete runtime/plugin pair atomically.
RUN npm install --prefix /opt/openclaw \
      "openclaw@${OPENCLAW_VERSION}" \
      "@cognee/cognee-openclaw@${COGNEE_PLUGIN_VERSION}" \
      --omit=dev \
 && /opt/openclaw/node_modules/.bin/openclaw --version \
 && test -f /opt/openclaw/node_modules/@cognee/cognee-openclaw/package.json

COPY apps/feat-openclaw-tenant/deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create data/config mount points. Executable runtime code remains under read-only /opt/openclaw.
RUN mkdir -p /data/openclaw /data/secrets /config /etc/openclaw

ENV OPENCLAW_STATE_DIR=/data/openclaw
ENV OPENCLAW_SECRETS_DIR=/data/secrets
ENV OPENCLAW_ENCRYPTION_KEY_PATH=/etc/openclaw/encryption-key/key
ENV PATH=/opt/openclaw/node_modules/.bin:${PATH}

EXPOSE 18789

ENTRYPOINT ["/entrypoint.sh"]
