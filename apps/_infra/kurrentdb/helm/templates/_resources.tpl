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
{{- $siloId := .Values.clustertenantManager.firstUser.clusterTenant | default .Release.Name -}}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $serviceName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
automountServiceAccountToken: false
---
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
  replay.sh: |
    {{- (index .Subcharts "opencrane-kurrentdb").Files.Get "files/replay.sh" | nindent 4 }}
  replay-target.json: |
    {"endpoint":"https://{{ $serviceName }}.{{ .Release.Namespace }}.svc:{{ $history.service.port }}","streamName":"computer-activations-{{ $siloId }}"}
  bootstrap.sh: |
    {{- (index .Subcharts "opencrane-kurrentdb").Files.Get "files/bootstrap.sh" | nindent 4 }}
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
          env:
            - name: KURRENTDB_BOOTSTRAP_ENDPOINT
              value: "https://{{ $serviceName }}.{{ .Release.Namespace }}.svc:{{ $history.service.port }}"
            - name: KURRENTDB_BOOTSTRAP_CA_FILE
              value: /var/run/opencrane/kurrentdb-tls/ca.crt
            - name: KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE
              value: /var/run/opencrane/kurrentdb-bootstrap-admin/password
            - name: KURRENTDB_HISTORY_USERNAME_FILE
              value: /var/run/opencrane/kurrentdb-service/username
            - name: KURRENTDB_HISTORY_PASSWORD_FILE
              value: /var/run/opencrane/kurrentdb-service/password
            - name: KURRENTDB_BOOTSTRAP_SILO_ID
              value: {{ $siloId | quote }}
            - name: KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS
              value: {{ $history.activationSubscription.maxSubscriberCount | quote }}
            - name: KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS
              value: {{ $history.bootstrap.timeoutSeconds | quote }}
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
            - name: KURRENTDB_ENABLE_ATOM_PUB_OVER_HTTP
              value: "true"
            - name: KURRENTDB_NODE_PORT
              value: {{ $history.service.port | quote }}
            - name: KURRENTDB_CERTIFICATE_FILE
              value: /var/run/opencrane/kurrentdb/tls.crt
            - name: KURRENTDB_CERTIFICATE_PRIVATE_KEY_FILE
              value: /var/run/opencrane/kurrentdb/tls.key
            - name: KURRENTDB_TRUSTED_ROOT_CERTIFICATES_PATH
              value: /var/run/opencrane/kurrentdb-roots
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
          # /health/live is served over the node's TLS listener without credentials; the official
          # secure-cluster compose examples probe it the same way. The kubelet does not verify the
          # private CA, so the probe proves the HTTP/gRPC listener answers, not the certificate.
          readinessProbe:
            httpGet:
              path: /health/live
              port: grpc
              scheme: HTTPS
            initialDelaySeconds: {{ $history.probes.readiness.initialDelaySeconds }}
            periodSeconds: {{ $history.probes.readiness.periodSeconds }}
            timeoutSeconds: {{ $history.probes.readiness.timeoutSeconds }}
            failureThreshold: {{ $history.probes.readiness.failureThreshold }}
          livenessProbe:
            httpGet:
              path: /health/live
              port: grpc
              scheme: HTTPS
            initialDelaySeconds: {{ $history.probes.liveness.initialDelaySeconds }}
            periodSeconds: {{ $history.probes.liveness.periodSeconds }}
            timeoutSeconds: {{ $history.probes.liveness.timeoutSeconds }}
            failureThreshold: {{ $history.probes.liveness.failureThreshold }}
          resources:
            {{- toYaml $history.resources | nindent 12 }}
          volumeMounts:
            - name: kurrentdb-tls
              mountPath: /var/run/opencrane/kurrentdb
              readOnly: true
            - name: kurrentdb-roots
              mountPath: /var/run/opencrane/kurrentdb-roots
              readOnly: true
            - name: data
              mountPath: /var/lib/kurrentdb
      volumes:
        - name: kurrentdb-tls
          secret:
            secretName: {{ $history.tls.existingSecret }}
            defaultMode: 0440
            items:
              - key: tls.crt
                path: tls.crt
              - key: tls.key
                path: tls.key
        - name: kurrentdb-roots
          secret:
            secretName: {{ $history.tls.existingSecret }}
            defaultMode: 0440
            items:
              - key: ca.crt
                path: ca.crt
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
{{- if $history.podDisruptionBudget.enabled }}
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ $serviceName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
spec:
  minAvailable: {{ $history.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: kurrentdb
{{- end }}
{{- if $history.backup.enabled }}
{{ include "opencrane.kurrentdb.backup" . }}
{{- end }}
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
        {{- range $history.dnsResolverCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
{{- end }}
{{- end }}
{{- end }}
