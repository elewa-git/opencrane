FROM mcr.microsoft.com/devcontainers/javascript-node:5.0.2-24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl jq openssl python3 \
    && rm -rf /var/lib/apt/lists/*
