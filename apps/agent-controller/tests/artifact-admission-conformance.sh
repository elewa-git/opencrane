#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 4 ]]; then
  echo "usage: artifact-admission-conformance.sh <server-namespace> <artifact-namespace> <release-fullname> <server-internal-port>" >&2
  exit 2
fi

SERVER_NAMESPACE="$1"
ARTIFACT_NAMESPACE="$2"
RELEASE_FULLNAME="$3"
SERVER_INTERNAL_PORT="$4"
CONTROLLER_USER="system:serviceaccount:${SERVER_NAMESPACE}:agent-controller"
WRONG_USER="system:serviceaccount:${SERVER_NAMESPACE}:default"
JOB_NAME="artifact-preprocess-aaaaaaaaaaaaaaaaaaaaaaaa"
ARTIFACT_IMAGE="ghcr.io/elewa-git/opencrane-artifact-preprocessor@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
TMP_DIR="$(mktemp -d)"
BASE_JOB="$TMP_DIR/artifact-job.yaml"
VARIANT_JOB="$TMP_DIR/artifact-job-variant.yaml"

function _cleanup()
{
  kubectl delete job "$JOB_NAME" --namespace "$ARTIFACT_NAMESPACE" --ignore-not-found --wait=true >/dev/null 2>&1 || true
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
    echo "[artifact-admission] invalid artifact preprocessing Job was accepted: $label" >&2
    exit 1
  fi
}

cat >"$BASE_JOB" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${ARTIFACT_NAMESPACE}
  labels:
    app.kubernetes.io/component: artifact-preprocessor
    opencrane.ai/artifact-preprocessor: ${JOB_NAME}
  annotations:
    opencrane.ai/bootstrap-reference: artifact-preprocess-bootstrap-v1_0000000000000000000000000000000000000000000000000000000000000000
spec:
  suspend: true
  parallelism: 1
  completions: 1
  backoffLimit: 0
  activeDeadlineSeconds: 300
  template:
    metadata:
      labels:
        app.kubernetes.io/component: artifact-preprocessor
        opencrane.ai/artifact-preprocessor: ${JOB_NAME}
      annotations:
        opencrane.ai/bootstrap-reference: artifact-preprocess-bootstrap-v1_0000000000000000000000000000000000000000000000000000000000000000
    spec:
      serviceAccountName: artifact-preprocessor
      automountServiceAccountToken: false
      enableServiceLinks: false
      restartPolicy: Never
      terminationGracePeriodSeconds: 0
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: artifact-preprocessor
          image: ${ARTIFACT_IMAGE}
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          env:
            - name: OPENCRANE_INTERNAL_URL
              value: http://${RELEASE_FULLNAME}-opencrane-server.${SERVER_NAMESPACE}.svc.cluster.local:${SERVER_INTERNAL_PORT}
            - name: OPENCRANE_PREPROCESSOR_TOKEN_PATH
              value: /var/run/opencrane/tokens/opencrane.token
            - name: OPENCRANE_PREPROCESSOR_BOOTSTRAP_REFERENCE_PATH
              value: /var/run/opencrane/bootstrap/reference
            - name: ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY
              value: /scratch
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 1000m
              memory: 512Mi
          volumeMounts:
            - name: opencrane-token
              mountPath: /var/run/opencrane/tokens
              readOnly: true
            - name: bootstrap-reference
              mountPath: /var/run/opencrane/bootstrap
              readOnly: true
            - name: scratch
              mountPath: /scratch
      volumes:
        - name: opencrane-token
          projected:
            defaultMode: 288
            sources:
              - serviceAccountToken:
                  path: opencrane.token
                  audience: opencrane-artifact-preprocessor
                  expirationSeconds: 600
        - name: bootstrap-reference
          downwardAPI:
            defaultMode: 288
            items:
              - path: reference
                fieldRef:
                  fieldPath: metadata.annotations['opencrane.ai/bootstrap-reference']
        - name: scratch
          emptyDir:
            sizeLimit: 128Mi
EOF

echo "[artifact-admission] verifying the exact suspended Job is accepted"
kubectl create --dry-run=server --as "$CONTROLLER_USER" --filename "$BASE_JOB" >/dev/null

cp "$BASE_JOB" "$VARIANT_JOB"
_expect_create_denied "wrong actor" "$WRONG_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/serviceAccountName","value":"agent-controller"}]'
_expect_create_denied "controller ServiceAccount" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"ghcr.io/elewa-git/opencrane-artifact-preprocessor:latest"}]'
_expect_create_denied "mutable image" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/containers/0/env/0/value","value":"http://foreign.default.svc.cluster.local:8081"}]'
_expect_create_denied "foreign broker" "$CONTROLLER_USER"

_variant '[{"op":"add","path":"/spec/template/spec/containers/0/command","value":["sh","-c","id"]}]'
_expect_create_denied "caller-selected command" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/template/spec/volumes/2","value":{"name":"scratch","hostPath":{"path":"/","type":"Directory"}}}]'
_expect_create_denied "host volume" "$CONTROLLER_USER"

_variant '[{"op":"replace","path":"/spec/suspend","value":false}]'
_expect_create_denied "unsuspended create" "$CONTROLLER_USER"

echo "[artifact-admission] verifying only the exact one-time unsuspend update is accepted"
kubectl create --as "$CONTROLLER_USER" --filename "$BASE_JOB" >/dev/null
if kubectl patch job "$JOB_NAME" --namespace "$ARTIFACT_NAMESPACE" --as "$CONTROLLER_USER" --type json --patch '[{"op":"replace","path":"/spec/backoffLimit","value":1},{"op":"replace","path":"/spec/suspend","value":false}]' >/dev/null 2>&1; then
  echo "[artifact-admission] release plus an unrelated Job mutation was accepted" >&2
  exit 1
fi
kubectl patch job "$JOB_NAME" --namespace "$ARTIFACT_NAMESPACE" --as "$CONTROLLER_USER" --type json --patch '[{"op":"replace","path":"/spec/activeDeadlineSeconds","value":299},{"op":"replace","path":"/spec/suspend","value":false}]' >/dev/null
if kubectl patch job "$JOB_NAME" --namespace "$ARTIFACT_NAMESPACE" --as "$CONTROLLER_USER" --type json --patch '[{"op":"replace","path":"/spec/suspend","value":true}]' >/dev/null 2>&1; then
  echo "[artifact-admission] a released artifact preprocessing Job was resuspended" >&2
  exit 1
fi

echo "[artifact-admission] server-side artifact preprocessing Job admission conformance passed"
