{{- define "opencrane.agentController.resources" -}}
{{- if .Values.agentController.enabled }}
{{- $fullName := include "opencrane.fullname" . -}}
{{- $namespace := default .Release.Namespace .Values.agentController.namespace -}}
{{- $openCraneInternalUrl := .Values.agentController.openCraneInternalUrl | default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" $fullName .Release.Namespace .Values.clustertenantManager.service.internalPort) -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $fullName }}-agent-controller
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
automountServiceAccountToken: false
---
# The controller may create, observe, suspend, and delete only its owned Job objects.
# It cannot read Secrets, authenticate other workloads, or mutate any other resource type.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $fullName }}-agent-controller
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $fullName }}-agent-controller
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $fullName }}-agent-controller
subjects:
  - kind: ServiceAccount
    name: {{ $fullName }}-agent-controller
    namespace: {{ $namespace }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $fullName }}-agent-controller
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
spec:
  replicas: {{ .Values.agentController.replicas }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: agent-controller
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: agent-controller
    spec:
      serviceAccountName: {{ $fullName }}-agent-controller
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: agent-controller
          image: "{{ .Values.agentController.image.repository }}:{{ .Values.agentController.image.tag }}"
          imagePullPolicy: {{ .Values.agentController.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          env:
            - name: OPENCRANE_INTERNAL_URL
              value: {{ $openCraneInternalUrl | quote }}
            - name: AGENT_CONTROLLER_WORKLOAD_NAMESPACE
              value: {{ $namespace | quote }}
            - name: AGENT_CONTROLLER_KUBERNETES_TOKEN_PATH
              value: /var/run/opencrane/tokens/kubernetes/token
            - name: AGENT_CONTROLLER_KUBERNETES_CA_PATH
              value: /var/run/opencrane/tokens/kubernetes/ca.crt
            - name: AGENT_CONTROLLER_OPENCRANE_TOKEN_PATH
              value: /var/run/opencrane/tokens/opencrane/token
            - name: AGENT_RUNTIME_SERVICE_ACCOUNT
              value: {{ required "agentController.runtimeServiceAccountName is required when agentController.enabled=true" .Values.agentController.runtimeServiceAccountName | quote }}
            - name: AGENT_RUNTIME_IMAGE
              value: {{ required "agentController.runtimeImage is required when agentController.enabled=true" .Values.agentController.runtimeImage | quote }}
            - name: AGENT_CONTROLLER_POLL_INTERVAL_MS
              value: {{ .Values.agentController.pollIntervalMs | quote }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "agent-controller") | nindent 12 }}
          volumeMounts:
            - name: kubernetes-api-token
              mountPath: /var/run/opencrane/tokens/kubernetes
              readOnly: true
            - name: opencrane-token
              mountPath: /var/run/opencrane/tokens/opencrane
              readOnly: true
          resources:
            {{- toYaml .Values.agentController.resources | nindent 12 }}
      volumes:
        # This token is only for the Kubernetes API. Its audience differs from the
        # server token below, so a token accepted by one authority is useless to the other.
        - name: kubernetes-api-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  audience: https://kubernetes.default.svc
                  expirationSeconds: {{ .Values.agentController.projectedTokenTtlSeconds }}
              - configMap:
                  # Kubernetes creates this namespace-local trust bundle. It lets the controller
                  # verify the API server while still keeping the API audience token explicit.
                  name: kube-root-ca.crt
                  items:
                    - key: ca.crt
                      path: ca.crt
        - name: opencrane-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  audience: agent-controller
                  expirationSeconds: {{ .Values.agentController.projectedTokenTtlSeconds }}
---
# The controller has no inbound API. Egress is constrained to its two required
# authorities: Kubernetes Jobs/Pods and the OpenCrane internal listener, plus DNS/telemetry.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $fullName }}-agent-controller
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: agent-controller
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress:
    # Service traffic cannot be selected by NetworkPolicy. Operators explicitly provide
    # the API-server CIDR for their cluster instead of silently allowing all HTTPS egress.
    - to:
        - ipBlock:
            cidr: {{ required "agentController.kubernetesApi.cidr is required when agentController.enabled=true" .Values.agentController.kubernetesApi.cidr | quote }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.kubernetesApi.port | default 443 }}
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
              kubernetes.io/metadata.name: {{ $namespace }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
{{- end }}
{{- end }}
