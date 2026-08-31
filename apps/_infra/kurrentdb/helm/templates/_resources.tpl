{{- define "opencrane.kurrentdb.resources" -}}
{{- $history := .Values.historyStore.kurrentdb -}}
{{- if $history.enabled }}
{{- if empty $history.image.digest }}{{- fail "historyStore.kurrentdb.image.digest is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.tls.existingSecret }}{{- fail "historyStore.kurrentdb.tls.existingSecret is required when KurrentDB is enabled" }}{{- end }}
{{- if empty $history.bootstrapAdmin.existingSecret }}{{- fail "historyStore.kurrentdb.bootstrapAdmin.existingSecret is required when KurrentDB is enabled" }}{{- end }}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-kurrentdb
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
automountServiceAccountToken: false
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "opencrane.fullname" . }}-kurrentdb
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
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "opencrane.fullname" . }}-kurrentdb
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
spec:
  serviceName: {{ include "opencrane.fullname" . }}-kurrentdb
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
    spec:
      serviceAccountName: {{ include "opencrane.fullname" . }}-kurrentdb
      automountServiceAccountToken: false
      containers:
        - name: kurrentdb
          image: "{{ $history.image.repository }}@{{ $history.image.digest }}"
          imagePullPolicy: {{ $history.image.pullPolicy }}
          ports:
            - name: grpc
              containerPort: {{ $history.service.port }}
          env:
            - name: KURRENTDB_CLUSTER_SIZE
              value: "1"
            - name: KURRENTDB_INSECURE
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
                  key: {{ $history.bootstrapAdmin.passwordKey }}
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
            defaultMode: 0400
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
  name: {{ include "opencrane.fullname" . }}-kurrentdb
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: kurrentdb
  policyTypes: [Ingress, Egress]
  ingress: []
  egress: []
{{- end }}
{{- end }}
{{- end }}
