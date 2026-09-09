#!/usr/bin/env bash
set -euo pipefail

# Installs the release-pinned cluster-wide Agent Sandbox prerequisite through its app-owned boundary.
VERSION="v0.5.3"
MANIFEST_SHA256="e21a561002a800f78d05d45cb80d773f1651ba6cc0e2b6b9d5110846db031c4d"
IMAGE="registry.k8s.io/agent-sandbox/agent-sandbox-controller@sha256:ba381b4e0c86cca597d5c5a31860e38d30ec1c45e0a7a8328bb2799c87d059c0"
URL="https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${VERSION}/sandbox-with-extensions.yaml"
CONTEXT=""
PREFLIGHT_ONLY=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--context)
			[[ $# -ge 2 && -n "$2" ]] || { echo "--context requires a value" >&2; exit 2; }
			CONTEXT="$2"
			shift 2
			;;
		--preflight) PREFLIGHT_ONLY=true; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 2 ;;
	esac
done

[[ -n "$CONTEXT" ]] || { echo "--context is required" >&2; exit 2; }
[[ "$(kubectl config current-context)" == "$CONTEXT" ]] || { echo "Current context does not match --context" >&2; exit 1; }

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
source_manifest="$work_dir/agent-sandbox.yaml"
pinned_manifest="$work_dir/agent-sandbox-pinned.yaml"
configured_manifest="$work_dir/agent-sandbox-configured.yaml"
curl -fsSL "$URL" -o "$source_manifest"
[[ "$(shasum -a 256 "$source_manifest" | awk '{print $1}')" == "$MANIFEST_SHA256" ]] || { echo "Agent Sandbox manifest checksum mismatch" >&2; exit 1; }
sed "s#registry.k8s.io/agent-sandbox/agent-sandbox-controller:${VERSION}#${IMAGE}#g" "$source_manifest" > "$pinned_manifest"
grep -Fq -- '--extensions' "$pinned_manifest"
[[ "$(grep -Fc -- "$IMAGE" "$pinned_manifest")" == "1" ]] || { echo "Pinned controller image replacement is incomplete" >&2; exit 1; }

# The pinned controller reads this file at startup; it has no label-domain command-line flag.
# See https://github.com/kubernetes-sigs/agent-sandbox/blob/v0.5.3/cmd/agent-sandbox-controller/main.go.
# Release admission still limits callers to the three admitted opencrane.ai lease labels.
cat >> "$pinned_manifest" <<'YAML'
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: opencrane-agent-sandbox-label-domains
  namespace: agent-sandbox-system
data:
  allowed-label-domains: opencrane.ai
YAML
cat > "$work_dir/controller-config.patch.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-sandbox-controller
  namespace: agent-sandbox-system
spec:
  template:
    spec:
      containers:
        - name: agent-sandbox-controller
          volumeMounts:
            - name: opencrane-label-domains
              mountPath: /etc/sandbox-config
              readOnly: true
      volumes:
        - name: opencrane-label-domains
          configMap:
            name: opencrane-agent-sandbox-label-domains
            items:
              - key: allowed-label-domains
                path: allowed-label-domains
YAML
cat > "$work_dir/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - agent-sandbox-pinned.yaml
patches:
  - path: controller-config.patch.yaml
    target:
      group: apps
      version: v1
      kind: Deployment
      name: agent-sandbox-controller
      namespace: agent-sandbox-system
YAML
kubectl kustomize "$work_dir" > "$configured_manifest"

if [[ "$PREFLIGHT_ONLY" == "true" ]]; then
	echo "Agent Sandbox ${VERSION} manifest, immutable controller image and opencrane.ai label configuration are qualified."
	exit 0
fi

kubectl --context "$CONTEXT" apply --server-side --field-manager=opencrane-agent-sandbox -f "$configured_manifest"
kubectl --context "$CONTEXT" rollout status deployment/agent-sandbox-controller --namespace agent-sandbox-system --timeout=180s
for crd in sandboxes.agents.x-k8s.io sandboxclaims.extensions.agents.x-k8s.io sandboxtemplates.extensions.agents.x-k8s.io sandboxwarmpools.extensions.agents.x-k8s.io; do
	versions="$(kubectl --context "$CONTEXT" get crd "$crd" -o jsonpath='{range .spec.versions[*]}{.name}:{.served}:{.storage}{"\n"}{end}')"
	grep -Fxq 'v1beta1:true:true' <<<"$versions" || { echo "$crd does not serve and store v1beta1" >&2; exit 1; }
done
