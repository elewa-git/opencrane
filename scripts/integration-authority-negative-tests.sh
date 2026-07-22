#!/bin/sh
set -eu

# Resolve the repository root so this guard remains correct from its Nx package cwd.
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

if grep -R -n -E 'McpAssignmentReference|mcpAssignments|mcpServerId|agent_revision_mcp_assignments' \
  apps/opencrane/prisma/bootstrap/target-baseline.sql \
  apps/opencrane/prisma/schema/agent-services.prisma \
  libs/models/agents/main/src \
  libs/backend/server/agents/agent-services/main/src; then
  echo "target AgentRevision integration authority still contains MCP-assignment residue" >&2
  exit 1
fi

if grep -R -n -E '@opencrane/backend/server/gateways/mcp|McpServer|OpenClaw|StaticFallback|credentialRef|oauth' \
  libs/backend/server/gateways/integrations/main/src; then
  echo "integration authority must not depend on legacy MCP, OpenClaw, or credential material" >&2
  exit 1
fi

echo "Integration authority negative tests passed."
