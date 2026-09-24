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

_exact_vendor_image()
{
  local tagged_image="$1" exact_image
  docker pull "$tagged_image" >/dev/null
  exact_image="$(docker image inspect "$tagged_image" --format '{{index .RepoDigests 0}}')"
  [[ "$exact_image" =~ @sha256:[0-9a-f]{64}$ ]] || {
    echo "[hosted-services] Vendor image has no immutable digest: $tagged_image" >&2
    return 1
  }
  printf '%s\n' "$exact_image"
}

_prepare()
{
  local control_plane_host="$5" owner_email="$6" namespace="$7"
  local oidc_email="requester@${namespace}.opencrane.test"
  [[ "$owner_email" != "$oidc_email" ]] || {
    echo "[hosted-services] Owner and requester must be different fixture identities" >&2
    return 1
  }
  mkdir -p "$RUN_DIR/tls" "$RUN_DIR/registry-auth" "$RUN_DIR/evidence"
  : > "$STATE_FILE"
  chmod 0700 "$RUN_DIR" "$RUN_DIR/tls" "$RUN_DIR/registry-auth"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$RUN_DIR/tls/ca-key.pem" >/dev/null 2>&1
  openssl req -x509 -new -key "$RUN_DIR/tls/ca-key.pem" -sha256 -days 1 \
    -subj "/CN=OpenCrane hosted qualification CA" -out "$RUN_DIR/tls/ca.crt"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$RUN_DIR/tls/server-key.pem" >/dev/null 2>&1
  openssl req -new -key "$RUN_DIR/tls/server-key.pem" -subj "/CN=host.k3d.internal" -out "$RUN_DIR/tls/server.csr"
  openssl x509 -req -in "$RUN_DIR/tls/server.csr" -CA "$RUN_DIR/tls/ca.crt" -CAkey "$RUN_DIR/tls/ca-key.pem" \
    -CAcreateserial -days 1 -sha256 \
    -extfile <(printf 'subjectAltName=DNS:hosted-generated-file-registry.%s.svc,DNS:hosted-generated-file-registry.%s.svc.cluster.local,DNS:hosted-generated-file-protocol.%s.svc,DNS:hosted-generated-file-protocol.%s.svc.cluster.local,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' "$namespace" "$namespace" "$namespace" "$namespace") \
    -out "$RUN_DIR/tls/server.crt" >/dev/null 2>&1
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$RUN_DIR/oidc-signing-key.pem" >/dev/null 2>&1

  local registry_password oidc_client_secret session_secret
  registry_password="$(openssl rand -hex 24)"
  oidc_client_secret="$(openssl rand -hex 24)"
  session_secret="$(openssl rand -hex 32)"
  printf '%s' "$registry_password" > "$RUN_DIR/registry-password"
  printf 'Basic %s' "$(printf 'opencrane-hosted:%s' "$registry_password" | openssl base64 -A)" > "$RUN_DIR/registry-authorization"
  printf '%s' "$oidc_client_secret" > "$RUN_DIR/oidc-client-secret"
  printf '%s' "evidence-$(openssl rand -hex 24)" > "$RUN_DIR/evidence-key"
  printf '%s' "$session_secret" > "$RUN_DIR/oidc-session-secret"
  chmod 0600 "$RUN_DIR"/*-secret "$RUN_DIR"/*-key.pem "$RUN_DIR"/tls/*-key.pem "$RUN_DIR/evidence-key" "$RUN_DIR/registry-password" "$RUN_DIR/registry-authorization" 2>/dev/null || true

  _write_state HOSTED_CA_PATH "$RUN_DIR/tls/ca.crt"
  _write_state HOSTED_TLS_CERTIFICATE_PATH "$RUN_DIR/tls/server.crt"
  _write_state HOSTED_TLS_KEY_PATH "$RUN_DIR/tls/server-key.pem"
  _write_state HOSTED_OIDC_SIGNING_KEY_PATH "$RUN_DIR/oidc-signing-key.pem"
  _write_state HOSTED_REGISTRY_PASSWORD_PATH "$RUN_DIR/registry-password"
  _write_state HOSTED_REGISTRY_AUTHORIZATION_PATH "$RUN_DIR/registry-authorization"
  _write_state HOSTED_OIDC_CLIENT_SECRET_PATH "$RUN_DIR/oidc-client-secret"
  _write_state HOSTED_OIDC_SESSION_SECRET_PATH "$RUN_DIR/oidc-session-secret"
  _write_state HOSTED_EVIDENCE_KEY_PATH "$RUN_DIR/evidence-key"
  _write_state HOSTED_OIDC_CLIENT_ID "hosted-generated-file"
  _write_state HOSTED_OIDC_SUBJECT "hosted-generated-file-requester"
  _write_state HOSTED_OIDC_EMAIL "$oidc_email"
  _write_state HOSTED_OWNER_OIDC_SUBJECT "hosted-generated-file-first-owner"
  _write_state HOSTED_OWNER_OIDC_EMAIL "$owner_email"
  _write_state HOSTED_OIDC_REDIRECT_URI "https://${control_plane_host}:8443/api/v1/auth/callback"
  _write_state HOSTED_NAMESPACE "$namespace"
  _write_state HOSTED_EVIDENCE_PATH "$RUN_DIR/evidence/hosted-generated-file.json"
  local registry_image httpd_image registry_password
  registry_image="$(_exact_vendor_image registry:2)"
  httpd_image="$(_exact_vendor_image httpd:2.4-alpine)"
  registry_password="$(<"$RUN_DIR/registry-password")"
  docker run --rm "$httpd_image" htpasswd -Bbn opencrane-hosted "$registry_password" > "$RUN_DIR/registry-auth/htpasswd"
  cat > "$RUN_DIR/k3s-registries.yaml" <<EOF
mirrors:
  "hosted-generated-file-registry.${namespace}.svc:443":
    endpoint:
      - "https://hosted-generated-file-registry.${namespace}.svc:443"
configs:
  "hosted-generated-file-registry.${namespace}.svc:443":
    auth:
      username: "opencrane-hosted"
      password: "${registry_password}"
    tls:
      ca_file: "/etc/rancher/k3s/hosted-generated-file/ca.crt"
EOF
  _write_state HOSTED_REGISTRY_IMAGE "$registry_image"
  _write_state HOSTED_REGISTRY_SERVICE_IP "10.43.0.53"
  _write_state HOSTED_REGISTRY_URL "https://hosted-generated-file-registry.${namespace}.svc:443"
  _write_state HOSTED_REGISTRY_REPOSITORY "opencrane/mcp-file-generator"
  _write_state HOSTED_K3S_REGISTRY_CONFIG_PATH "$RUN_DIR/k3s-registries.yaml"
}

_start_registry()
{
  _load_state
  kubectl create namespace "$HOSTED_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
  k3d image import "$HOSTED_REGISTRY_IMAGE" --cluster "$CLUSTER_NAME" --mode direct
  kubectl create secret generic hosted-generated-file-registry \
    --namespace "$HOSTED_NAMESPACE" \
    --from-file=server.crt="$HOSTED_TLS_CERTIFICATE_PATH" \
    --from-file=server-key.pem="$HOSTED_TLS_KEY_PATH" \
    --from-file=htpasswd="$RUN_DIR/registry-auth/htpasswd" \
    --dry-run=client -o yaml | kubectl apply -f -
  cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hosted-generated-file-registry
  namespace: ${HOSTED_NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/component: hosted-generated-file-registry }
  template:
    metadata:
      labels: { app.kubernetes.io/component: hosted-generated-file-registry }
    spec:
      automountServiceAccountToken: false
      securityContext:
        fsGroup: 1000
        runAsGroup: 1000
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: registry
          image: ${HOSTED_REGISTRY_IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - { name: REGISTRY_AUTH, value: htpasswd }
            - { name: REGISTRY_AUTH_HTPASSWD_REALM, value: OpenCraneHostedQualification }
            - { name: REGISTRY_AUTH_HTPASSWD_PATH, value: /auth/htpasswd }
            - { name: REGISTRY_HTTP_ADDR, value: 0.0.0.0:5000 }
            - { name: REGISTRY_HTTP_TLS_CERTIFICATE, value: /tls/server.crt }
            - { name: REGISTRY_HTTP_TLS_KEY, value: /tls/server-key.pem }
          ports: [{ name: https, containerPort: 5000 }]
          readinessProbe: { tcpSocket: { port: https }, periodSeconds: 2 }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
            readOnlyRootFilesystem: true
          volumeMounts:
            - { name: credentials, mountPath: /auth, readOnly: true }
            - { name: credentials, mountPath: /tls, readOnly: true }
            - { name: storage, mountPath: /var/lib/registry }
      volumes:
        - name: credentials
          secret: { secretName: hosted-generated-file-registry, defaultMode: 0440 }
        - name: storage
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: hosted-generated-file-registry
  namespace: ${HOSTED_NAMESPACE}
spec:
  clusterIP: ${HOSTED_REGISTRY_SERVICE_IP}
  selector: { app.kubernetes.io/component: hosted-generated-file-registry }
  ports: [{ name: https, port: 443, targetPort: https }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hosted-generated-file-registry
  namespace: ${HOSTED_NAMESPACE}
spec:
  podSelector:
    matchLabels: { app.kubernetes.io/component: hosted-generated-file-registry }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app.kubernetes.io/component: opencrane-server }
      ports: [{ protocol: TCP, port: 5000 }]
  egress: []
EOF
  kubectl rollout status deployment/hosted-generated-file-registry -n "$HOSTED_NAMESPACE" --timeout=120s
}

case "$MODE" in
  prepare) _prepare "$@" ;;
  start-registry) _start_registry ;;
  *) echo "[hosted-registry-fixture] Unknown mode: $MODE" >&2; exit 1 ;;
esac
