#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: identity-conformance.sh <server-namespace> <release-fullname>" >&2
  exit 2
fi

SERVER_NAMESPACE="$1"
RELEASE_FULLNAME="$2"
JOB_NAME="agent-controller-tokenreview-conformance"
SERVICE_NAME="${RELEASE_FULLNAME}-opencrane-server"
INTERNAL_PORT="$(kubectl get service "$SERVICE_NAME" --namespace "$SERVER_NAMESPACE" -o jsonpath='{.spec.ports[?(@.name=="internal")].port}')"

if [[ -z "$INTERNAL_PORT" ]]; then
  echo "[identity] server Service has no internal port: $SERVICE_NAME" >&2
  exit 1
fi

function _cleanup()
{
  kubectl delete job "$JOB_NAME" --namespace "$SERVER_NAMESPACE" --ignore-not-found --wait=true >/dev/null 2>&1 || true
}
trap _cleanup EXIT

_cleanup
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${SERVER_NAMESPACE}
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 60
  template:
    metadata:
      labels:
        app.kubernetes.io/name: opencrane
        app.kubernetes.io/instance: ${RELEASE_FULLNAME}
        app.kubernetes.io/component: agent-controller
    spec:
      serviceAccountName: agent-controller
      automountServiceAccountToken: false
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: tokenreview-conformance
          image: opencrane/opencrane-server:e2e
          imagePullPolicy: Never
          command: ["node", "--input-type=module", "-e"]
          args:
            - |
              import { readFile } from "node:fs/promises";
              const token = (await readFile("/var/run/opencrane/tokens/opencrane.token", "utf8")).trim();
              const url = "http://${SERVICE_NAME}.${SERVER_NAMESPACE}.svc.cluster.local:${INTERNAL_PORT}/api/internal/agent-controller/run-attempts:claim";
              let response;
              let lastTransportError;
              for (let attempt = 1; attempt <= 10; attempt += 1) {
                try {
                  response = await fetch(url, {
                    method: "POST",
                    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
                    body: "{}",
                    signal: AbortSignal.timeout(2000),
                  });
                  break;
                } catch (error) {
                  lastTransportError = error;
                  if (attempt < 10) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                  }
                }
              }
              if (!response) {
                throw new Error("controller TokenReview conformance transport failed after 10 attempts", { cause: lastTransportError });
              }
              if (response.status !== 200 && response.status !== 204) {
                throw new Error("controller TokenReview conformance failed with HTTP " + response.status);
              }
          volumeMounts:
            - name: controller-token
              mountPath: /var/run/opencrane/tokens
              readOnly: true
      volumes:
        - name: controller-token
          projected:
            defaultMode: 288
            sources:
              - serviceAccountToken:
                  path: opencrane.token
                  audience: opencrane-agent-controller
                  expirationSeconds: 600
EOF

if ! kubectl wait --for=condition=Complete "job/${JOB_NAME}" --namespace "$SERVER_NAMESPACE" --timeout=75s; then
  kubectl logs "job/${JOB_NAME}" --namespace "$SERVER_NAMESPACE" --all-containers >&2 || true
  exit 1
fi

echo "[identity] controller projected-token TokenReview passed through enforced network policy"
