#!/usr/bin/env bash
set -euo pipefail

MODE="${1:?mode is required}"
RUN_DIR="${2:?run directory is required}"
CLUSTER_NAME="${3:?cluster name is required}"
ROOT_DIR="${4:?repository root is required}"
STATE_FILE="$RUN_DIR/hosted-services.env"

_quote()
{
  printf '%q' "$1"
}

_write_state()
{
  local name="$1" value="$2"
  printf '%s=%s\n' "$name" "$(_quote "$value")" >> "$STATE_FILE"
}

_load_state()
{
  [[ -f "$STATE_FILE" ]] || { echo "[hosted-services] Missing state file" >&2; exit 1; }
  # The state file is created only by this helper and contains shell-escaped generated paths/values.
  # shellcheck disable=SC1090
  source "$STATE_FILE"
}

_start_protocol()
{
  _load_state
  local server_image_id port_forward_pid
  server_image_id="$(docker image inspect opencrane/opencrane-server:develop-smoke --format '{{.Id}}')"
  [[ "$server_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "[hosted-services] Server fixture image is not exact" >&2; exit 1; }
  kubectl create configmap hosted-generated-file-protocol \
    --namespace "$HOSTED_NAMESPACE" \
    --from-file=protocol-fixture.mjs="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/fixtures/hosted-generated-file/protocol-fixture.mjs" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl create secret generic hosted-generated-file-protocol \
    --namespace "$HOSTED_NAMESPACE" \
    --from-file=server.crt="$HOSTED_TLS_CERTIFICATE_PATH" \
    --from-file=server-key.pem="$HOSTED_TLS_KEY_PATH" \
    --from-file=oidc-signing-key.pem="$HOSTED_OIDC_SIGNING_KEY_PATH" \
    --from-file=oidc-client-secret="$HOSTED_OIDC_CLIENT_SECRET_PATH" \
    --from-file=evidence-key="$HOSTED_EVIDENCE_KEY_PATH" \
    --dry-run=client -o yaml | kubectl apply -f -
  cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hosted-generated-file-protocol
  namespace: ${HOSTED_NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/component: hosted-generated-file-protocol }
  template:
    metadata:
      labels: { app.kubernetes.io/component: hosted-generated-file-protocol }
    spec:
      automountServiceAccountToken: false
      securityContext:
        fsGroup: 1000
        runAsGroup: 1000
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: protocol
          image: opencrane/opencrane-server:develop-smoke
          imagePullPolicy: IfNotPresent
          command: [node, /fixture-app/protocol-fixture.mjs]
          env:
            - { name: HOSTED_FIXTURE_HOST, value: 0.0.0.0 }
            - { name: HOSTED_FIXTURE_PORT, value: "9443" }
            - { name: HOSTED_FIXTURE_ISSUER, value: "https://hosted-generated-file-protocol.${HOSTED_NAMESPACE}.svc:9443" }
            - { name: HOSTED_FIXTURE_OIDC_CLIENT_ID, value: "${HOSTED_OIDC_CLIENT_ID}" }
            - name: HOSTED_FIXTURE_OIDC_CLIENT_SECRET
              valueFrom: { secretKeyRef: { name: hosted-generated-file-protocol, key: oidc-client-secret } }
            - { name: HOSTED_FIXTURE_OIDC_REDIRECT_URI, value: "${HOSTED_OIDC_REDIRECT_URI}" }
            - { name: HOSTED_FIXTURE_OIDC_OWNER_SUBJECT, value: "${HOSTED_OWNER_OIDC_SUBJECT}" }
            - { name: HOSTED_FIXTURE_OIDC_OWNER_EMAIL, value: "${HOSTED_OWNER_OIDC_EMAIL}" }
            - { name: HOSTED_FIXTURE_OIDC_REQUESTER_SUBJECT, value: "${HOSTED_OIDC_SUBJECT}" }
            - { name: HOSTED_FIXTURE_OIDC_REQUESTER_EMAIL, value: "${HOSTED_OIDC_EMAIL}" }
            - name: HOSTED_FIXTURE_EVIDENCE_KEY
              valueFrom: { secretKeyRef: { name: hosted-generated-file-protocol, key: evidence-key } }
            - { name: HOSTED_FIXTURE_UPSTREAM_MODEL, value: hosted-generated-file }
            - { name: HOSTED_FIXTURE_SIGNING_KEY_ID, value: hosted-generated-file }
            - { name: HOSTED_FIXTURE_SIGNING_KEY_PATH, value: /fixture-secret/oidc-signing-key.pem }
            - { name: HOSTED_FIXTURE_TLS_KEY_PATH, value: /fixture-secret/server-key.pem }
            - { name: HOSTED_FIXTURE_TLS_CERTIFICATE_PATH, value: /fixture-secret/server.crt }
            - name: HOSTED_FIXTURE_CSV_ARGUMENTS
              value: '{"displayName":"county-summary.csv","headers":["County","Customers"],"rows":[["Nairobi",3],["Kisumu",2]]}'
          ports:
            - { name: https, containerPort: 9443 }
            - { name: model, containerPort: 4000 }
          readinessProbe: { httpGet: { path: /healthz, port: https, scheme: HTTPS }, periodSeconds: 2 }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
            readOnlyRootFilesystem: true
          volumeMounts:
            - { name: source, mountPath: /fixture-app, readOnly: true }
            - { name: credentials, mountPath: /fixture-secret, readOnly: true }
      volumes:
        - name: source
          configMap: { name: hosted-generated-file-protocol, defaultMode: 0440 }
        - name: credentials
          secret: { secretName: hosted-generated-file-protocol, defaultMode: 0440 }
---
apiVersion: v1
kind: Service
metadata:
  name: hosted-generated-file-protocol
  namespace: ${HOSTED_NAMESPACE}
spec:
  selector: { app.kubernetes.io/component: hosted-generated-file-protocol }
  ports:
    - { name: https, port: 9443, targetPort: https }
    - { name: model, port: 4000, targetPort: model }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hosted-generated-file-protocol
  namespace: ${HOSTED_NAMESPACE}
spec:
  podSelector:
    matchLabels: { app.kubernetes.io/component: hosted-generated-file-protocol }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app.kubernetes.io/component: opencrane-server }
      ports: [{ protocol: TCP, port: 9443 }]
    - from:
        - podSelector:
            matchLabels: { app.kubernetes.io/component: litellm }
      ports: [{ protocol: TCP, port: 4000 }]
  egress: []
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hosted-generated-file-server-egress
  namespace: ${HOSTED_NAMESPACE}
spec:
  podSelector:
    matchLabels: { app.kubernetes.io/component: opencrane-server }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/component: hosted-generated-file-protocol }
      ports:
        - { protocol: TCP, port: 9443 }
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/component: hosted-generated-file-registry }
      ports:
        - { protocol: TCP, port: 443 }
        - { protocol: TCP, port: 5000 }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hosted-generated-file-litellm-provider
  namespace: ${HOSTED_NAMESPACE}
spec:
  podSelector:
    matchLabels: { app.kubernetes.io/component: litellm }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/component: hosted-generated-file-protocol }
      ports: [{ protocol: TCP, port: 4000 }]
EOF
  kubectl rollout status deployment/hosted-generated-file-protocol -n "$HOSTED_NAMESPACE" --timeout=120s
  kubectl port-forward -n "$HOSTED_NAMESPACE" service/hosted-generated-file-protocol 19443:9443 \
    > "$RUN_DIR/protocol-port-forward.log" 2>&1 &
  port_forward_pid=$!
  _write_state HOSTED_PROTOCOL_PORT_FORWARD_PID "$port_forward_pid"
  _write_state HOSTED_PROTOCOL_URL "https://hosted-generated-file-protocol.${HOSTED_NAMESPACE}.svc:9443"
  _write_state HOSTED_PROTOCOL_TRANSPORT_URL "https://127.0.0.1:19443"
}

_stop()
{
  if [[ -f "$STATE_FILE" ]]; then
    _load_state
    if [[ -n "${HOSTED_PROTOCOL_PORT_FORWARD_PID:-}" ]]; then
      kill "$HOSTED_PROTOCOL_PORT_FORWARD_PID" >/dev/null 2>&1 || true
      wait "$HOSTED_PROTOCOL_PORT_FORWARD_PID" >/dev/null 2>&1 || true
    fi
  fi
}

case "$MODE" in
  start-protocol) _start_protocol ;;
  stop) _stop ;;
  *) echo "[hosted-protocol-service] Unknown mode: $MODE" >&2; exit 1 ;;
esac
