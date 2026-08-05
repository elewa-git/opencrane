{{- define "opencrane.memoryGateway.resources" -}}
{{- if not .Values.clustertenantManager.cognee.install }}
{{- fail "TODO: BYO/non-private Cognee is disabled until authenticated memory-gateway transport is implemented" }}
{{- end }}
{{- if not .Values.networkPolicy.enabled }}
{{- fail "private Cognee requires networkPolicy.enabled=true so the memory gateway remains its only network caller" }}
{{- end }}
{{- if not .Values.memoryGateway.kubernetesApiServerCidrs }}
{{- fail "memoryGateway.kubernetesApiServerCidrs requires the exact Kubernetes API Service address for bounded TokenReview egress" }}
{{- end }}
{{- if not .Values.memoryGateway.kubernetesApiServerEndpointCidrs }}
{{- fail "memoryGateway.kubernetesApiServerEndpointCidrs requires exact Kubernetes API backing endpoints for bounded TokenReview egress" }}
{{- end }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-memory-gateway
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: memory-gateway
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "opencrane.fullname" . }}-memory-gateway-tokenreview-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
rules:
  - apiGroups: ["authentication.k8s.io"]
    resources: ["tokenreviews"]
    verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "opencrane.fullname" . }}-memory-gateway-tokenreview-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "opencrane.fullname" . }}-memory-gateway-tokenreview-{{ .Release.Namespace }}
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" . }}-memory-gateway
    namespace: {{ .Release.Namespace }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-memory-gateway
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: memory-gateway
spec:
  replicas: {{ .Values.memoryGateway.replicas }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: memory-gateway
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: memory-gateway
    spec:
      serviceAccountName: {{ include "opencrane.fullname" . }}-memory-gateway
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: memory-gateway
          image: "{{ .Values.memoryGateway.image.repository }}:{{ .Values.memoryGateway.image.tag }}"
          imagePullPolicy: {{ .Values.memoryGateway.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          ports:
            - name: http
              containerPort: {{ .Values.memoryGateway.service.port }}
          env:
            - name: PORT
              value: {{ .Values.memoryGateway.service.port | quote }}
            - name: COGNEE_URL
              value: {{ include "opencrane.cogneeEndpoint" . | quote }}
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: SERVER_SERVICE_ACCOUNT_NAME
              value: {{ include "opencrane.fullname" . }}-opencrane-server
            - name: SERVER_TOKEN_AUDIENCE
              value: opencrane-memory-gateway
            - name: REQUEST_TIMEOUT_MS
              value: {{ mul .Values.memoryGateway.httpTimeoutSeconds 1000 | quote }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "memory-gateway") | nindent 12 }}
          volumeMounts:
            - name: kubernetes-token
              mountPath: /var/run/secrets/kubernetes.io/serviceaccount
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
            {{- toYaml .Values.memoryGateway.resources | nindent 12 }}
      volumes:
        - name: kubernetes-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  audience: https://kubernetes.default.svc
                  expirationSeconds: {{ .Values.memoryGateway.projectedTokenTtlSeconds }}
              - configMap:
                  name: kube-root-ca.crt
                  items:
                    - key: ca.crt
                      path: ca.crt
              - downwardAPI:
                  items:
                    - path: namespace
                      fieldRef:
                        fieldPath: metadata.namespace
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "opencrane.fullname" . }}-memory-gateway
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: memory-gateway
spec:
  type: ClusterIP
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: memory-gateway
  ports:
    - name: http
      protocol: TCP
      port: {{ .Values.memoryGateway.service.port }}
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-memory-gateway
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: memory-gateway
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: memory-gateway
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ .Values.memoryGateway.service.port }}
  egress:
    - to:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: cognee
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.cognee.service.port }}
    {{- if .Values.networkPolicy.allowDNS }}
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
    # TokenReview is the gateway's only Kubernetes API call. Name both the Service IP and
    # post-translation endpoints because CNI enforcement point differs by implementation.
    - to:
        {{- range .Values.memoryGateway.kubernetesApiServerCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.memoryGateway.kubernetesApiServerPort }}
    - to:
        {{- range .Values.memoryGateway.kubernetesApiServerEndpointCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.memoryGateway.kubernetesApiServerEndpointPort }}
    {{- if .Values.observability.otel.enabled }}
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
{{- end }}
