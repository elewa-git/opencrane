{{/* Resolve and validate the namespace containing only the malware scanner and zero-RBAC identity. */}}
{{- define "opencrane.artifactScanner.namespace" -}}
{{- $workerNamespace := default (printf "%s-artifact-scanning" (include "opencrane.fullname" .) | trunc 63 | trimSuffix "-") .Values.artifactScanner.namespace -}}
{{- if or (gt (len $workerNamespace) 63) (not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $workerNamespace)) -}}
{{- fail "artifactScanner.namespace must be a valid DNS-label namespace of at most 63 characters" -}}
{{- end -}}
{{- if eq $workerNamespace .Release.Namespace -}}
{{- fail "artifactScanner.namespace must remain distinct from the trusted server namespace" -}}
{{- end -}}
{{- $workerNamespace -}}
{{- end -}}

{{- define "opencrane.artifactScanner.resources" -}}
{{- if .Values.artifactScanner.enabled }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.artifactScanner.image.digest) }}
{{- fail "artifactScanner.enabled=true requires an immutable sha256 artifactScanner.image.digest" }}
{{- end }}
{{- if lt (mul (int .Values.artifactScanner.claimLeaseSeconds) 1000) (add (mul (int .Values.artifactScanner.requestTimeoutMs) 2) (int .Values.artifactScanner.scanTimeoutMs)) }}
{{- fail "artifactScanner.claimLeaseSeconds must cover source read, scan, and result request deadlines" }}
{{- end }}
{{- $workerNamespace := include "opencrane.artifactScanner.namespace" . -}}
{{- $serverUrl := printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort -}}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-scanner
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: artifact-scanner
  namespace: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-scanner
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-artifact-scanner
  namespace: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-scanner
spec:
  replicas: {{ .Values.artifactScanner.replicas }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: artifact-scanner
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: artifact-scanner
    spec:
      serviceAccountName: artifact-scanner
      automountServiceAccountToken: false
      enableServiceLinks: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: artifact-scanner
          image: {{ printf "%s@%s" .Values.artifactScanner.image.repository .Values.artifactScanner.image.digest | quote }}
          imagePullPolicy: {{ .Values.artifactScanner.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          env:
            - name: OPENCRANE_INTERNAL_URL
              value: {{ $serverUrl | quote }}
            - name: OPENCRANE_SCANNER_TOKEN_PATH
              value: /var/run/opencrane/tokens/opencrane.token
            - name: ARTIFACT_SCANNER_SCRATCH_DIRECTORY
              value: /scratch
            - name: ARTIFACT_SCANNER_EXECUTABLE_PATH
              value: /usr/bin/clamscan
            - name: ARTIFACT_SCANNER_DATABASE_PATH
              value: /var/lib/clamav
            - name: ARTIFACT_SCANNER_VERSION
              value: {{ .Values.artifactScanner.scannerVersion | quote }}
            - name: ARTIFACT_SCANNER_POLL_INTERVAL_MS
              value: {{ .Values.artifactScanner.pollIntervalMs | quote }}
            - name: ARTIFACT_SCANNER_REQUEST_TIMEOUT_MS
              value: {{ .Values.artifactScanner.requestTimeoutMs | quote }}
            - name: ARTIFACT_SCANNER_MAX_SOURCE_BYTES
              value: {{ .Values.artifactScanner.maximumSourceBytes | quote }}
            - name: ARTIFACT_SCANNER_SCAN_TIMEOUT_MS
              value: {{ .Values.artifactScanner.scanTimeoutMs | quote }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "artifact-scanner") | nindent 12 }}
          volumeMounts:
            - name: opencrane-token
              mountPath: /var/run/opencrane/tokens
              readOnly: true
            - name: scratch
              mountPath: /scratch
          resources:
            {{- toYaml .Values.artifactScanner.resources | nindent 12 }}
      volumes:
        - name: opencrane-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: opencrane.token
                  audience: opencrane-artifact-scanner
                  expirationSeconds: {{ .Values.artifactScanner.projectedTokenTtlSeconds }}
        - name: scratch
          emptyDir:
            sizeLimit: {{ .Values.artifactScanner.scratchSize | quote }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-artifact-scanner
  namespace: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-scanner
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: artifact-scanner
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
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
    {{- if .Values.observability.otel.enabled }}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
{{- end }}
{{- end }}
