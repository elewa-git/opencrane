{{- define "opencrane.kurrentdb.resources" -}}
{{- $history := .Values.historyStore.kurrentdb -}}
{{- if $history.enabled }}
{{- if empty $history.image.digest }}{{- fail "historyStore.kurrentdb.image.digest is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.tls.existingSecret }}{{- fail "historyStore.kurrentdb.tls.existingSecret is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrapAdmin.existingSecret }}{{- fail "historyStore.kurrentdb.bootstrapAdmin.existingSecret is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrapOps.existingSecret }}{{- fail "historyStore.kurrentdb.bootstrapOps.existingSecret is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.serviceCredential.existingSecret }}{{- fail "historyStore.kurrentdb.serviceCredential.existingSecret is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrap.image.repository }}{{- fail "historyStore.kurrentdb.bootstrap.image.repository is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrap.image.digest }}{{- fail "historyStore.kurrentdb.bootstrap.image.digest is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrap.image.pullPolicy }}{{- fail "historyStore.kurrentdb.bootstrap.image.pullPolicy is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrap.timeoutSeconds }}{{- fail "historyStore.kurrentdb.bootstrap.timeoutSeconds is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrap.activeDeadlineSeconds }}{{- fail "historyStore.kurrentdb.bootstrap.activeDeadlineSeconds is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrap.resources }}{{- fail "historyStore.kurrentdb.bootstrap.resources is required when KurrentDB is enabled" }}{{- end }}
{{- $fullName := include "opencrane.fullname" . -}}
{{- $serviceName := printf "%s-kurrentdb" $fullName -}}
{{- $bootstrapName := printf "%s-kurrentdb-bootstrap" $fullName -}}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $serviceName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
automountServiceAccountToken: false
apiVersion: v1
kind: Service
metadata:
  name: {{ $serviceName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
spec:
  type: ClusterIP
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
  ports:
    - name: grpc
      port: {{ $history.service.port }}
      targetPort: grpc
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ $bootstrapName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-bootstrap
data:
  bootstrap.sh: |
    #!/bin/sh
    set -eu

    endpoint="https://{{ $serviceName }}.{{ .Release.Namespace }}.svc:{{ $history.service.port }}"
    admin_password="$(cat /var/run/opencrane/kurrentdb-bootstrap-admin/password)"
    history_username="$(cat /var/run/opencrane/kurrentdb-service/username)"
    history_password="$(cat /var/run/opencrane/kurrentdb-service/password)"

    if [ "$history_username" != "opencrane-history" ] || [ -z "$admin_password" ] || [ -z "$history_password" ]; then
      echo "KurrentDB bootstrap credentials must contain the fixed non-empty service identity." >&2
      exit 1
    fi
    wait_deadline="$(( $(date +%s) + {{ $history.bootstrap.timeoutSeconds }} ))"
    until curl --silent --show-error --fail --cacert /var/run/opencrane/kurrentdb-tls/ca.crt --user "admin:$admin_password" "$endpoint/health/live" >/dev/null; do
      if [ "$(date +%s)" -ge "$wait_deadline" ]; then
        echo "KurrentDB did not become ready before the bootstrap deadline." >&2
        exit 1
      fi
      sleep 2
    done

    user_body="$(mktemp)"
    user_status="$(curl --silent --show-error --output "$user_body" --write-out '%{http_code}' --cacert /var/run/opencrane/kurrentdb-tls/ca.crt --user "admin:$admin_password" "$endpoint/users/opencrane-history")"
    case "$user_status" in
      200)
        normalized_user="$(tr -d '[:space:]' < "$user_body")"
        if ! printf '%s' "$normalized_user" | grep -Eq '"([Ll]ogin[Nn]ame|[Uu]sername)":"opencrane-history"' || ! printf '%s' "$normalized_user" | grep -Eq '"([Gg]roups)":\[\]'; then
          echo "The existing KurrentDB service user is not the expected unprivileged identity." >&2
          exit 1
        fi
        ;;
      404)
        create_body="$(mktemp)"
        jq -n --arg password "$history_password" '{LoginName: "opencrane-history", FullName: "OpenCrane HistoryStore", Groups: [], Password: $password}' > "$create_body"
        create_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert /var/run/opencrane/kurrentdb-tls/ca.crt --user "admin:$admin_password" --header 'Content-Type: application/json' --data-binary "@$create_body" "$endpoint/users")"
        rm -f "$create_body"
        if [ "$create_status" != "201" ] && [ "$create_status" != "200" ]; then
          echo "KurrentDB refused creation of the HistoryStore service user (HTTP $create_status)." >&2
          exit 1
        fi
        ;;
      *)
        echo "KurrentDB did not return an expected service-user status (HTTP $user_status)." >&2
        exit 1
        ;;
    esac
    rm -f "$user_body"

    # The Job verifies the existing ACL after an initial write does not succeed.
    settings_body="$(mktemp)"
    cat > "$settings_body" <<'JSON'
    [
      {
        "eventId": "1253ddcb-3c10-4a1c-80bf-b16d1a5b8fcb",
        "eventType": "opencrane-history-default-acl",
        "data": {
          "$userStreamAcl": {
            "$r": ["$admins", "opencrane-history"],
            "$w": ["$admins", "opencrane-history"],
            "$d": "$admins",
            "$mr": "$admins",
            "$mw": "$admins"
          },
          "$systemStreamAcl": {
            "$r": "$admins",
            "$w": "$admins",
            "$d": "$admins",
            "$mr": "$admins",
            "$mw": "$admins"
          }
        }
      }
    ]
    JSON
    settings_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert /var/run/opencrane/kurrentdb-tls/ca.crt --user "admin:$admin_password" --header 'Content-Type: application/vnd.kurrent.events+json' --header 'Kurrent-ExpectedVersion: -1' --data-binary "@$settings_body" "$endpoint/streams/%24settings")"
    rm -f "$settings_body"
    if [ "$settings_status" != "201" ] && [ "$settings_status" != "200" ] && [ "$settings_status" != "400" ]; then
      echo "KurrentDB refused the HistoryStore default ACL write (HTTP $settings_status)." >&2
      exit 1
    fi

    existing_settings="$(mktemp)"
    existing_settings_status="$(curl --silent --show-error --output "$existing_settings" --write-out '%{http_code}' --cacert /var/run/opencrane/kurrentdb-tls/ca.crt --user "admin:$admin_password" --header 'Accept: application/vnd.kurrent.atom+json' "$endpoint/streams/%24settings?embed=body")"
    if [ "$existing_settings_status" != "200" ] || ! jq -e '
      .. | objects | select(
        .["$userStreamAcl"] == {
          "$r": ["$admins", "opencrane-history"],
          "$w": ["$admins", "opencrane-history"],
          "$d": "$admins",
          "$mr": "$admins",
          "$mw": "$admins"
        } and .["$systemStreamAcl"] == {
          "$r": "$admins",
          "$w": "$admins",
          "$d": "$admins",
          "$mr": "$admins",
          "$mw": "$admins"
        }
      )
    ' "$existing_settings" >/dev/null; then
      rm -f "$existing_settings"
      echo "The existing KurrentDB default ACL is not exactly the HistoryStore ACL." >&2
      exit 1
    fi
    rm -f "$existing_settings"

    service_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert /var/run/opencrane/kurrentdb-tls/ca.crt --user "$history_username:$history_password" "$endpoint/streams/opencrane-history-bootstrap-probe")"
    if [ "$service_status" != "200" ] && [ "$service_status" != "404" ]; then
      echo "The KurrentDB service credential cannot read the default HistoryStore stream boundary." >&2
      exit 1
    fi
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ $bootstrapName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-bootstrap
spec:
  backoffLimit: {{ $history.bootstrap.backoffLimit }}
  activeDeadlineSeconds: {{ $history.bootstrap.activeDeadlineSeconds }}
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: kurrentdb-bootstrap
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: bootstrap
          image: "{{ $history.bootstrap.image.repository }}@{{ $history.bootstrap.image.digest }}"
          imagePullPolicy: {{ $history.bootstrap.image.pullPolicy }}
          command: ["/bin/sh", "/opt/opencrane/kurrentdb-bootstrap/bootstrap.sh"]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            {{- toYaml $history.bootstrap.resources | nindent 12 }}
          volumeMounts:
            - name: bootstrap-script
              mountPath: /opt/opencrane/kurrentdb-bootstrap
              readOnly: true
            - name: kurrentdb-tls
              mountPath: /var/run/opencrane/kurrentdb-tls
              readOnly: true
            - name: kurrentdb-bootstrap-admin
              mountPath: /var/run/opencrane/kurrentdb-bootstrap-admin
              readOnly: true
            - name: kurrentdb-service
              mountPath: /var/run/opencrane/kurrentdb-service
              readOnly: true
            - name: scratch
              mountPath: /tmp
      volumes:
        - name: bootstrap-script
          configMap:
            name: {{ $bootstrapName }}
            defaultMode: 0550
        - name: kurrentdb-tls
          secret:
            secretName: {{ $history.tls.existingSecret }}
            defaultMode: 0440
        - name: kurrentdb-bootstrap-admin
          secret:
            secretName: {{ $history.bootstrapAdmin.existingSecret }}
            defaultMode: 0440
            items:
              - key: password
                path: password
        - name: kurrentdb-service
          secret:
            secretName: {{ $history.serviceCredential.existingSecret }}
            defaultMode: 0440
            items:
              - key: username
                path: username
              - key: password
                path: password
        - name: scratch
          emptyDir:
            sizeLimit: 16Mi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ $serviceName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
spec:
  serviceName: {{ $serviceName }}
  replicas: 1
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: kurrentdb
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: kurrentdb
      annotations:
        checksum/kurrentdb-tls: {{ (lookup "v1" "Secret" .Release.Namespace $history.tls.existingSecret).data | toJson | sha256sum }}
        checksum/kurrentdb-bootstrap-admin: {{ (lookup "v1" "Secret" .Release.Namespace $history.bootstrapAdmin.existingSecret).data | toJson | sha256sum }}
        checksum/kurrentdb-bootstrap-ops: {{ (lookup "v1" "Secret" .Release.Namespace $history.bootstrapOps.existingSecret).data | toJson | sha256sum }}
    spec:
      serviceAccountName: {{ $serviceName }}
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: kurrentdb
          image: "{{ $history.image.repository }}@{{ $history.image.digest }}"
          imagePullPolicy: {{ $history.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          ports:
            - name: grpc
              containerPort: {{ $history.service.port }}
          env:
            - name: KURRENTDB_CLUSTER_SIZE
              value: "1"
            - name: KURRENTDB_INSECURE
              value: "false"
            - name: KURRENTDB_ALLOW_ANONYMOUS_STREAM_ACCESS
              value: "false"
            - name: KURRENTDB_ALLOW_ANONYMOUS_ENDPOINT_ACCESS
              value: "false"
            - name: KURRENTDB_OVERRIDE_ANONYMOUS_ENDPOINT_ACCESS_FOR_GOSSIP
              value: "false"
            - name: KURRENTDB_ENABLE_TRUSTED_AUTH
              value: "false"
            - name: KURRENTDB_NODE_PORT
              value: {{ $history.service.port | quote }}
            - name: KURRENTDB_CERTIFICATE_FILE
              value: /var/run/opencrane/kurrentdb/tls.crt
            - name: KURRENTDB_CERTIFICATE_PRIVATE_KEY_FILE
              value: /var/run/opencrane/kurrentdb/tls.key
            - name: KURRENTDB_TRUSTED_ROOT_CERTIFICATES_PATH
              value: /var/run/opencrane/kurrentdb
            - name: KURRENTDB_DEFAULT_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ $history.bootstrapAdmin.existingSecret }}
                  key: password
            - name: KURRENTDB_DEFAULT_OPS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ $history.bootstrapOps.existingSecret }}
                  key: password
          readinessProbe:
            tcpSocket:
              port: grpc
            initialDelaySeconds: 20
            periodSeconds: 10
          livenessProbe:
            tcpSocket:
              port: grpc
            initialDelaySeconds: 40
            periodSeconds: 20
          resources:
            {{- toYaml $history.resources | nindent 12 }}
          volumeMounts:
            - name: kurrentdb-tls
              mountPath: /var/run/opencrane/kurrentdb
              readOnly: true
            - name: data
              mountPath: /var/lib/kurrentdb
      volumes:
        - name: kurrentdb-tls
          secret:
            secretName: {{ $history.tls.existingSecret }}
            defaultMode: 0440
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        {{- with $history.persistence.storageClassName }}
        storageClassName: {{ . | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ $history.persistence.size | quote }}
{{- if .Values.networkPolicy.enabled }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $serviceName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: kurrentdb
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace | quote }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace | quote }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: kurrentdb-bootstrap
      ports:
        - protocol: TCP
          port: {{ $history.service.port }}
  egress: []
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $bootstrapName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-bootstrap
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: kurrentdb-bootstrap
  policyTypes: [Ingress, Egress]
  ingress: []
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace | quote }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: kurrentdb
      ports:
        - protocol: TCP
          port: {{ $history.service.port }}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
{{- end }}
{{- end }}
{{- end }}
