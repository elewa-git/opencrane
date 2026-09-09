#!/usr/bin/env bash

# Validates deployment inputs with Helm's existing value merging, schemas, and app-owned templates.
# The core calls this after maintenance exits and before preflight success or a cluster write.
require_conversation_deployment_profile()
(
  set -euo pipefail
  umask 077
  local fixture argument
  local validation_args=(--namespace "$NAMESPACE")
  fixture="$(mktemp -d)" || return $?
  trap 'rm -rf -- "$fixture"' EXIT
  mkdir -p "$fixture/chart/templates" "$fixture/chart/charts" || return $?

  # These library charts own the conversation resource contracts. Other workloads need Secrets
  # produced later in installation, so this render deliberately evaluates these two owners alone.
  sed '/^dependencies:/,$d' "$CHART_DIR/Chart.yaml" >"$fixture/chart/Chart.yaml" || return $?
  cp "$CHART_DIR/values.yaml" "$fixture/chart/values.yaml" || return $?
  cp "$CHART_DIR"/charts/k8s-platform-*.tgz \
    "$CHART_DIR"/charts/opencrane-kurrentdb-*.tgz \
    "$CHART_DIR"/charts/opencrane-agent-sandbox-*.tgz "$fixture/chart/charts/" || return $?
  jq '.properties |= with_entries(select(.key == "historyStore" or .key == "agentSandbox"))
      | del(.allOf)
      | .required = ["historyStore", "agentSandbox"]
      | .properties.historyStore.required = ["kurrentdb"]
      | .properties.historyStore.properties.kurrentdb.required += ["enabled"]
      | .properties.historyStore.properties.kurrentdb.properties.enabled = {"const": true}
      | .properties.agentSandbox.properties.enabled.const = true' \
    "$CHART_DIR/values.schema.json" >"$fixture/chart/values.schema.json" || return $?
  cat >"$fixture/chart/templates/required-conversation.yaml" <<'TEMPLATE' || return $?
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.historyStore.kurrentdb.image.digest) -}}
{{- fail "historyStore.kurrentdb.image.digest must be an immutable sha256 digest for deployment" -}}
{{- end -}}
{{ include "opencrane.kurrentdb.resources" . }}
---
{{ include "opencrane.agentSandbox.resources" . }}
TEMPLATE

  # Value flags retain Helm's own precedence, including raw --set-json/--set-file/--set-literal.
  # Reject options which could change the target, disable validation, or transform the manifests.
  while (( $# > 0 )); do
    argument="$1"
    shift
    case "$argument" in
      --values|-f|--set|--set-string|--set-json|--set-file|--set-literal|--timeout|--history-max|--description|--labels)
        if (( $# == 0 )); then
          err "A Helm passthrough option is missing its value."
          return 1
        fi
        validation_args+=("$argument" "$1")
        shift
        ;;
      --values=*|-f?*|--set=*|--set-string=*|--set-json=*|--set-file=*|--set-literal=*|--timeout=*|--history-max=*|--description=*|--labels=*|--wait|--wait=*|--wait-for-jobs|--take-ownership|--force-conflicts|--force-replace|--cleanup-on-fail|--rollback-on-failure|--reuse-values|--reuse-values=true|--reuse-values=false|--reset-values|--reset-values=true|--reset-values=false|--reset-then-reuse-values|--reset-then-reuse-values=true|--reset-then-reuse-values=false)
        validation_args+=("$argument")
        ;;
      *)
        err "Unsupported Helm passthrough option. Use deployment flags for target and validation settings."
        return 1
        ;;
    esac
  done

  # Helm reads the existing release itself, so --reuse-values keeps its old chart defaults and
  # --reset-then-reuse-values refreshes them exactly as in the final upgrade. Server dry-run reads
  # the actual Kubernetes capabilities and Secret lookups without persisting release resources.
  # Redirect all output because a profile or a Helm schema error can contain operator secrets.
  if ! helm upgrade --install "$RELEASE" "$fixture/chart" \
    "${validation_args[@]}" --dry-run=server --hide-secret --no-hooks \
    --disable-openapi-validation >/dev/null 2>&1; then
    err "Conversation deployment inputs failed Helm validation: historyStore.kurrentdb.enabled and agentSandbox.enabled must be true; supply complete immutable images, Secret references, and an approved sandbox profile. Also check the target release is readable."
    return 1
  fi
)
