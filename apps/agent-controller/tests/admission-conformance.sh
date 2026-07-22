#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "usage: admission-conformance.sh <server-namespace> <runtime-namespace> <release-fullname>" >&2
  exit 2
fi

SERVER_NAMESPACE="$1"
RUNTIME_NAMESPACE="$2"
RELEASE_FULLNAME="$3"
CONTROLLER_USER="system:serviceaccount:${SERVER_NAMESPACE}:agent-controller"
WRONG_USER="system:serviceaccount:${SERVER_NAMESPACE}:default"
JOB_NAME="agent-runtime-a1-aaaaaaaaaaaaaaaaaaaaaaaa"
RUNTIME_IMAGE="ghcr.io/italanta/opencrane-agent-runtime@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
TMP_DIR="$(mktemp -d)"
BASE_JOB="$TMP_DIR/runtime-job.yaml"
VARIANT_JOB="$TMP_DIR/runtime-job-variant.yaml"

function _cleanup()
{
  kubectl delete job "$JOB_NAME" --namespace "$RUNTIME_NAMESPACE" --ignore-not-found --wait=true >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap _cleanup EXIT

function _variant()
{
  local patch="$1"
  kubectl patch --local --filename "$BASE_JOB" --type json --patch "$patch" --output yaml >"$VARIANT_JOB"
}

function _expect_create_denied()
{
  local label="$1"
  local username="$2"
  if kubectl create --dry-run=server --as "$username" --filename "$VARIANT_JOB" >/dev/null 2>&1; then
    echo "[admission] invalid runtime Job was accepted: $label" >&2
    exit 1
  fi
}

cat >"$BASE_JOB" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${RUNTIME_NAMESPACE}
  labels:
    app.kubernetes.io/name: opencrane-agent-runtime
    app.kubernetes.io/component: agent-runtime
    opencrane.ai/runtime-attempt: ${JOB_NAME}
  annotations:
    opencrane.ai/run-id: run-admission-conformance
    opencrane.ai/run-attempt: "1"
    opencrane.ai/agent-service-id: service-admission-conformance
    opencrane.ai/agent-revision-id: revision-admission-conformance
    opencrane.ai/silo-id: silo-admission-conformance
spec:
  suspend: true
  parallelism: 1
  completions: 1
  backoffLimit: 0
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: opencrane-agent-runtime
        app.kubernetes.io/component: agent-runtime
        opencrane.ai/runtime-attempt: ${JOB_NAME}
      annotations:
        opencrane.ai/run-id: run-admission-conformance
        opencrane.ai/run-attempt: "1"
        opencrane.ai/agent-service-id: service-admission-conformance
        opencrane.ai/agent-revision-id: revision-admission-conformance
        opencrane.ai/silo-id: silo-admission-conformance
        opencrane.ai/bootstrap-reference: bootstrap-v1_0000000000000000000000000000000000000000000000000000000000000000
    spec:
      serviceAccountName: agent-runtime-default
      automountServiceAccountToken: false
      enableServiceLinks: false
      restartPolicy: Never
      terminationGracePeriodSeconds: 0
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: agent-runtime
          image: ${RUNTIME_IMAGE}
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          env:
            - name: OPENCRANE_RUNTIME_STREAM_URL
              value: http://${RELEASE_FULLNAME}-opencrane-server.${SERVER_NAMESPACE}.svc.cluster.local:3001/api/internal/agent-runtime
            - name: OPENCRANE_RUNTIME_TOKEN_PATH
              value: /var/run/opencrane/tokens/runtime.token
            - name: POD_UID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.uid
          volumeMounts:
            - name: runtime-token
              mountPath: /var/run/opencrane/tokens
              readOnly: true
            - name: runtime-bootstrap
              mountPath: /var/run/opencrane/bootstrap
              readOnly: true
            - name: scratch
              mountPath: /tmp
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 1000m
              memory: 1Gi
      volumes:
        - name: runtime-token
          projected:
            defaultMode: 288
            sources:
              - serviceAccountToken:
                  path: runtime.token
                  audience: opencrane-agent-runtime
                  expirationSeconds: 600
        - name: runtime-bootstrap
          downwardAPI:
            defaultMode: 288
            items:
              - path: reference
                fieldRef:
                  fieldPath: metadata.annotations['opencrane.ai/bootstrap-reference']
        - name: scratch
          emptyDir:
            sizeLimit: 1Gi
EOF

echo "[admission] verifying the exact suspended Job is accepted"
kubectl create --dry-run=server --as "$CONTROLLER_USER" --filename "$BASE_JOB" >/dev/null

cp "$BASE_JOB" "$VARIANT_JOB"
_expect_create_denied "wrong actor" "$WRONG_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/serviceAccountName","value":"agent-controller"}]'
_expect_create_denied "controller ServiceAccount" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"ghcr.io/italanta/opencrane-agent-runtime:latest"}]'
_expect_create_denied "mutable image" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/volumes/2","value":{"name":"scratch","configMap":{"name":"foreign"}}}]'
_expect_create_denied "non-scratch volume" "$CONTROLLER_USER"

_variant '[{"op":"add","path":"/spec/template/spec/nodeName","value":"foreign-node"}]'
_expect_create_denied "direct node placement" "$CONTROLLER_USER"

_variant '[{"op":"add","path":"/spec/template/spec/containers/0/livenessProbe","value":{"exec":{"command":["sh","-c","cat /var/run/opencrane/tokens/runtime.token"]}}}]'
_expect_create_denied "executable liveness probe" "$CONTROLLER_USER"

_variant '[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe","value":{"exec":{"command":["sh","-c","cat /var/run/opencrane/bootstrap/reference"]}}}]'
_expect_create_denied "executable readiness probe" "$CONTROLLER_USER"

_variant '[{"op":"add","path":"/spec/template/spec/containers/0/startupProbe","value":{"exec":{"command":["sh","-c","id"]}}}]'
_expect_create_denied "executable startup probe" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/suspend","value":false}]'
_expect_create_denied "unsuspended create" "$CONTROLLER_USER"

echo "[admission] verifying only the exact one-time unsuspend update is accepted"
kubectl create --as "$CONTROLLER_USER" --filename "$BASE_JOB" >/dev/null
if kubectl patch job "$JOB_NAME" --namespace "$RUNTIME_NAMESPACE" --as "$CONTROLLER_USER" --type json --patch '[{"op":"replace","path":"/spec/ttlSecondsAfterFinished","value":1},{"op":"replace","path":"/spec/suspend","value":false}]' >/dev/null 2>&1; then
  echo "[admission] release plus an unrelated Job mutation was accepted" >&2
  exit 1
fi
kubectl patch job "$JOB_NAME" --namespace "$RUNTIME_NAMESPACE" --as "$CONTROLLER_USER" --type json --patch '[{"op":"replace","path":"/spec/activeDeadlineSeconds","value":3599},{"op":"replace","path":"/spec/suspend","value":false}]' >/dev/null
if kubectl patch job "$JOB_NAME" --namespace "$RUNTIME_NAMESPACE" --as "$CONTROLLER_USER" --type json --patch '[{"op":"replace","path":"/spec/suspend","value":true}]' >/dev/null 2>&1; then
  echo "[admission] a released runtime Job was resuspended" >&2
  exit 1
fi

echo "[admission] server-side runtime Job admission conformance passed"
