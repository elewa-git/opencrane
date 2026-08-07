{{- define "opencrane.channelProxy.resources" -}}
{{- if .Values.channelProxy.enabled }}
{{- $controlPlaneHost := .Values.ingress.controlPlaneHost | default (printf "platform.%s" .Values.ingress.domain) -}}
{{- $allowedOrigins := .Values.channelProxy.allowedOrigins | default (list (printf "https://%s" $controlPlaneHost)) -}}
{{- $openCraneInternalUrl := .Values.channelProxy.openCraneInternalUrl | default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort) -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-channel-proxy
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: channel-proxy
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-channel-proxy
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: channel-proxy
spec:
  replicas: {{ .Values.channelProxy.replicas }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: channel-proxy
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: channel-proxy
    spec:
      serviceAccountName: {{ include "opencrane.fullname" . }}-channel-proxy
      {{- with .Values.global.imagePullSecret }}
      imagePullSecrets:
        - name: {{ . | quote }}
      {{- end }}
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: channel-proxy
          image: "{{ .Values.channelProxy.image.repository }}:{{ .Values.channelProxy.image.tag }}"
          imagePullPolicy: {{ .Values.channelProxy.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          ports:
            - name: http
              containerPort: {{ .Values.channelProxy.service.port }}
          env:
            - name: PORT
              value: {{ .Values.channelProxy.service.port | quote }}
            - name: OPENCRANE_INTERNAL_URL
              value: {{ $openCraneInternalUrl | quote }}
            - name: CHANNEL_PROXY_ALLOWED_ORIGINS
              value: {{ join "," $allowedOrigins | quote }}
            - name: CHANNEL_PROXY_TARGET_HOST_SUFFIXES
              value: {{ join "," .Values.channelProxy.targetHostSuffixes | quote }}
            - name: CHANNEL_PROXY_RESOLVER_TIMEOUT_MS
              value: {{ .Values.channelProxy.resolverTimeoutMs | quote }}
            - name: CHANNEL_PROXY_COMMAND_TIMEOUT_MS
              value: {{ .Values.channelProxy.commandTimeoutMs | quote }}
            - name: CHANNEL_PROXY_STREAM_CONNECT_TIMEOUT_MS
              value: {{ .Values.channelProxy.streamConnectTimeoutMs | quote }}
            - name: CHANNEL_PROXY_STREAM_DURATION_MS
              value: {{ .Values.channelProxy.streamDurationMs | quote }}
            - name: CHANNEL_PROXY_STREAM_IDLE_TIMEOUT_MS
              value: {{ .Values.channelProxy.streamIdleTimeoutMs | quote }}
            - name: CHANNEL_PROXY_MAX_COMMAND_BYTES
              value: {{ .Values.channelProxy.maxCommandBytes | quote }}
            - name: CHANNEL_PROXY_MAX_COMMAND_RESPONSE_BYTES
              value: {{ .Values.channelProxy.maxCommandResponseBytes | quote }}
            - name: CHANNEL_PROXY_MAX_EVENT_BYTES
              value: {{ .Values.channelProxy.maxEventBytes | quote }}
            - name: CHANNEL_PROXY_RATE_LIMIT
              value: {{ .Values.channelProxy.rateLimit | quote }}
            - name: CHANNEL_PROXY_RATE_WINDOW_MS
              value: {{ .Values.channelProxy.rateWindowMs | quote }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "channel-proxy") | nindent 12 }}
          volumeMounts:
            - name: opencrane-token
              mountPath: /var/run/opencrane/tokens
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
            {{- toYaml .Values.channelProxy.resources | nindent 12 }}
      volumes:
        - name: opencrane-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: opencrane.token
                  audience: opencrane
                  expirationSeconds: {{ .Values.channelProxy.projectedTokenTtlSeconds }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "opencrane.fullname" . }}-channel-proxy
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: channel-proxy
spec:
  type: ClusterIP
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: channel-proxy
  ports:
    - name: http
      protocol: TCP
      port: {{ .Values.channelProxy.service.port }}
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-channel-proxy
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: channel-proxy
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: channel-proxy
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Values.channelProxy.ingressNamespace | quote }}
      ports:
        - protocol: TCP
          port: {{ .Values.channelProxy.service.port }}
  egress:
    # OpenCrane is the only application authority the channel boundary may resolve through.
    - to:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    # Cluster DNS is required to resolve the exact service routes returned by OpenCrane.
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
    # Telemetry export is allowed only to the operator-supplied release-local collector.
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
{{- end }}
{{- end }}
