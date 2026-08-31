#!/usr/bin/env bash
set -euo pipefail

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
helm template mcp-executor apps/mcp-executor/helm --namespace opencrane > "$manifest"
grep -Fq 'name: opencrane-mcp-executors' "$manifest"
grep -Fq 'pod-security.kubernetes.io/enforce: restricted' "$manifest"
grep -Fq 'opencrane.ai/retirement-owner: "mcp-executor"' "$manifest"
grep -Fq 'name: mcp-executor-default' "$manifest"
grep -Fq 'automountServiceAccountToken: false' "$manifest"
grep -Fq 'app.kubernetes.io/instance: "mcp-executor"' "$manifest"
grep -Fq 'app.kubernetes.io/managed-by: "Helm"' "$manifest"
grep -Fq 'name: mcp-executor-jobs' "$manifest"
grep -Fq 'count/jobs.batch: "10"' "$manifest"
grep -Fq 'name: mcp-executor-default-deny' "$manifest"
grep -Fq 'ingress: []' "$manifest"
grep -Fq 'egress: []' "$manifest"
grep -Fq 'name: mcp-executor-egress' "$manifest"
grep -Fq 'k8s-app: kube-dns' "$manifest"
grep -Fq 'kubernetes.io/metadata.name: opencrane' "$manifest"
grep -Fq 'app.kubernetes.io/component: opencrane-server' "$manifest"
grep -Fq 'port: 8081' "$manifest"
if grep -Eq '^kind: (Deployment|StatefulSet|DaemonSet|Job)$' "$manifest"; then
  echo "MCP executor chart must not create a standing or unfenced workload" >&2
  exit 1
fi
if grep -Eq '^kind: (Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' "$manifest"; then
  echo "MCP executor ServiceAccount must have zero Kubernetes RBAC" >&2
  exit 1
fi
if helm template mcp-executor apps/mcp-executor/helm --set-string mcpExecutor.serviceAccountName=agent-runtime-default >/dev/null 2>&1; then
  echo "a non-MCP ServiceAccount was accepted" >&2
  exit 1
fi
if helm template mcp-executor apps/mcp-executor/helm --namespace opencrane --set-string mcpExecutor.namespace=opencrane >/dev/null 2>&1; then
  echo "the server namespace was accepted as the MCP executor namespace" >&2
  exit 1
fi
