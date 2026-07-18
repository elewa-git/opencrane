{{- define "opencrane.artifactService.resources" -}}
{{- if .Values.artifactService.enabled }}
{{- $fullName := include "opencrane.fullname" . -}}
{{- $artifactNamespace := default (printf "%s-artifacts" .Release.Namespace) .Values.artifactService.namespace -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $fullName }}-artifact-service
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-service
automountServiceAccountToken: false
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ $fullName }}-artifact-service
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-service
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: {{ .Values.artifactService.persistence.size | quote }}
  {{- with .Values.artifactService.persistence.storageClass }}
  storageClassName: {{ . | quote }}
  {{- end }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $fullName }}-artifact-service
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-service
spec:
  replicas: {{ .Values.artifactService.replicas }}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: artifact-service
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: artifact-service
    spec:
      serviceAccountName: {{ $fullName }}-artifact-service
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: artifact-service
          image: "{{ .Values.artifactService.image.repository }}:{{ .Values.artifactService.image.tag }}"
          imagePullPolicy: {{ .Values.artifactService.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          ports:
            - name: http
              containerPort: {{ .Values.artifactService.service.port }}
          env:
            - name: PORT
              value: {{ .Values.artifactService.service.port | quote }}
            - name: ARTIFACT_ROOT
              value: /var/lib/opencrane/artifacts
            - name: ARTIFACT_MAX_UPLOAD_DURATION_MILLISECONDS
              value: {{ .Values.artifactService.maxUploadDurationMilliseconds | quote }}
            - name: ARTIFACT_LEASE_PUBLIC_KEY_PATH
              value: /var/run/opencrane/artifact-keys/lease-public.pem
            - name: ARTIFACT_RECEIPT_PRIVATE_KEY_PATH
              value: /var/run/opencrane/artifact-keys/receipt-private.pem
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "artifact-service") | nindent 12 }}
          volumeMounts:
            - name: artifact-bytes
              mountPath: /var/lib/opencrane/artifacts
            - name: artifact-keys
              mountPath: /var/run/opencrane/artifact-keys
              readOnly: true
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 2
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /livez
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            {{- toYaml .Values.artifactService.resources | nindent 12 }}
      volumes:
        - name: artifact-bytes
          persistentVolumeClaim:
            claimName: {{ $fullName }}-artifact-service
        - name: artifact-keys
          secret:
            secretName: {{ required "artifactService.keys.serviceExistingSecret is required" .Values.artifactService.keys.serviceExistingSecret | quote }}
            defaultMode: 0400
            items:
              - key: lease-public.pem
                path: lease-public.pem
              - key: receipt-private.pem
                path: receipt-private.pem
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $fullName }}-artifact-service
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-service
spec:
  type: ClusterIP
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-service
  ports:
    - name: http
      protocol: TCP
      port: {{ .Values.artifactService.service.port }}
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $fullName }}-artifact-service
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-service
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: artifact-service
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ .Values.artifactService.service.port }}
  egress:
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
