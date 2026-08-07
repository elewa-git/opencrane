{{- define "opencrane.server.networkPolicy" -}}
{{- $managedPlane := (index .Values "managedAgentRuntimePlane").managedAgentRuntime -}}
{{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") $managedPlane.namespace -}}
{{- if .Values.networkPolicy.enabled }}
# Network policy for the OpenCrane server.
#
# Two listeners, two ports:
#   - PUBLIC port (service.port): /api/v1/* + /auth, session-authed. Reachable from the
#     cluster ingress controller (external API traffic) and the fleet-manager.
#   - INTERNAL port (service.internalPort): /api/internal/* only, NO auth middleware — it
#     is workload-authenticated at each target route. Crucially the ingress controller is NOT permitted
#     to this port, so the internal routes are unreachable from the internet even though the
#     org ingress forwards `/api`. Permitted to the internal port:
#       - Channel proxy: /api/internal/channel-targets:resolve (TokenReview + delegated session).
#       - Per-attempt agent-runtime Job: outbound `/api/internal/agent-runtime/*` only; its projected
#         ServiceAccount token is TokenReviewed inside the route, so this rule is only the L3/4 floor.
#       - Governed skill Jobs: bootstrap acknowledgement, authoring input, and terminal completion only.
#         Their default-deny namespaces permit this single server destination and DNS; TokenReview binds
#         each request to the registered Pod. ArtifactStore remains unreachable from worker namespaces.
#
# NetworkPolicy cannot filter by URL path — the path/port split IS the boundary: internal
# routes only exist on the internal port, and only known platform pods may reach it.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: opencrane-server
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow the cluster ingress controller to forward external API requests.
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Values.networkPolicy.ingressNamespace | default "ingress-nginx" }}
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.port }}
    # Allow the channel trust boundary to request one workload-authenticated target decision.
    - from:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: channel-proxy
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    {{- if .Values.artifactPreprocessor.enabled }}
    # The dedicated artifact preprocessor can reach only the brokered internal API.
    # TokenReview binds its projected token to the exact worker ServiceAccount and namespace.
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ include "opencrane.artifactPreprocessor.namespace" . }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: artifact-preprocessor
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    {{- end }}
    # The controller authenticates its fixed KSA and projected audience before it may claim or
    # commit an assignment; this rule exposes only the internal listener at the L3/4 floor.
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: agent-controller
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    # Runtime Jobs own no listener and can only initiate this connection. TokenReview fixes each
    # personal or managed audience to its distinct namespace and ServiceAccount subject in-process.
    {{- if .Values.agentController.enabled }}
    - from:
        - namespaceSelector:
            matchLabels:
              opencrane.ai/runtime-release: {{ include "opencrane.agentController.runtimeNamespaceLabelValue" . | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: agent-runtime
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $managedRuntimeNamespace | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: agent-runtime
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    # Governed skill Jobs have no general network access. Admission fixes their component,
    # ServiceAccount and projected-token audience; the route TokenReviews the registered Pod UID.
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ (index .Values "opencrane-skill-authoring").skillAuthoring.namespace | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: skill-authoring
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ (index .Values "opencrane-tool-runner").toolRunner.namespace | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: tool-runner
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    {{- end }}
    # Allow the fleet-manager to reach the PUBLIC /api/v1/* API for cross-silo operations.
    - from:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: fleet-manager
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.port }}
  egress:
    {{- if .Values.agentController.kubernetesApiServerCidrs }}
    # TokenReview is the application-layer identity gate for controller and runtime calls. Keep the
    # server's API-server path on the same exact Service-IP allow-list as the controller.
    - to:
        {{- range .Values.agentController.kubernetesApiServerCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.kubernetesApiServerPort }}
    {{- end }}
    {{- if .Values.agentController.kubernetesApiServerEndpointCidrs }}
    # Mirror the controller's post-Service-translation API endpoint rule for the
    # in-process reconcilers and TokenReview calls owned by this server.
    - to:
        {{- range .Values.agentController.kubernetesApiServerEndpointCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.kubernetesApiServerEndpointPort }}
    {{- end }}
    # Every application connection goes through the CNPG-owned PgBouncer pooler.
    # The database Secret binds the exact authority while the pooler owns the
    # connection budget; direct CNPG-instance egress would bypass that boundary.
    # GKE Dataplane V2 evaluates server egress before the CNPG ClusterIP is
    # translated to its Pooler Pod, so a Pod selector cannot admit this path.
    # The rule is limited to PostgreSQL's port; the Pooler's ingress policy still
    # admits only this labelled server Pod (and its two named peer clients).
    -
      ports:
        - protocol: TCP
          port: 5432
    # Kubernetes API calls and external OIDC/provider APIs use HTTPS. Standard
    # NetworkPolicy cannot select the API Service or constrain external FQDNs, so
    # this is intentionally port-scoped; use Cilium to narrow external hostnames.
    - ports:
        - protocol: TCP
          port: 443
    {{- if .Values.networkPolicy.allowDNS }}
    # GKE Dataplane V2 evaluates egress before the kube-dns ClusterIP maps to a
    # CoreDNS Pod, so a Pod selector would reject DNS queries. Keep this limited
    # to DNS ports; every other outbound path is named below.
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    {{- end }}
    {{- if and .Values.litellm.enabled (ne (include "opencrane.litellmShared" .) "true") }}
    # Release-local model routing. Shared LiteLLM endpoints are expected to use HTTPS.
    - to:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: litellm
      ports:
        - protocol: TCP
          port: {{ .Values.litellm.service.port }}
    {{- end }}
    {{- if and .Values.mcpGateway.enabled (ne (include "opencrane.mcpGatewayShared" .) "true") }}
    # Release-local Obot management plane: custody provisioning and attempt-key minting only.
    # Tool invocation payloads flow runtime→Obot directly and never transit this server.
    - to:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: mcp-gateway
      ports:
        - protocol: TCP
          port: {{ .Values.mcpGateway.service.port }}
    {{- end }}
    {{- if .Values.observability.otel.enabled }}
    # Release-local operator-supplied OTEL collector for trace export.
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
    # Release-local memory recall: the private gateway is the server's only path toward Cognee.
    - to:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: memory-gateway
      ports:
        - protocol: TCP
          port: {{ .Values.memoryGateway.service.port }}
    # The only cross-namespace server call: the app-owned artifact byte plane.
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ default (printf "%s-artifacts" .Release.Namespace) .Values.artifactService.namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: artifact-service
      ports:
        - protocol: TCP
          port: {{ .Values.artifactService.service.port }}
---
{{- end }}
{{- if .Values.agentController.enabled }}
# Worker charts own namespace-wide default-deny. The server owns this strictly additive path because
# it owns the worker-facing bootstrap, authoring-input, and completion identity boundaries and knows the
# internal listener contract.
{{- $serverSelector := include "opencrane.selectorLabels" . }}
{{- $internalPort := .Values.clustertenantManager.service.internalPort }}
{{- range $worker := (list
  (dict "name" "skill-authoring-bootstrap" "namespace" (index $.Values "opencrane-skill-authoring").skillAuthoring.namespace "component" "skill-authoring")
  (dict "name" "tool-runner-bootstrap" "namespace" (index $.Values "opencrane-tool-runner").toolRunner.namespace "component" "tool-runner")) }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ printf "%s-%s" (include "opencrane.fullname" $) $worker.name | trunc 63 | trimSuffix "-" }}
  namespace: {{ $worker.namespace | quote }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: {{ $worker.component }}
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: {{ $worker.component }}
  policyTypes:
    - Egress
  egress:
    # A worker can bootstrap, read its server-brokered authoring input, and complete only through the internal listener.
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $.Release.Namespace | quote }}
          podSelector:
            matchLabels:
              {{- $serverSelector | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ $internalPort }}
    {{- if $.Values.networkPolicy.allowDNS }}
    # See the server policy: Dataplane V2 evaluates this before Service
    # translation, so this must be port-scoped instead of CoreDNS-Pod-scoped.
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    {{- end }}
---
{{- end }}
{{- end }}
{{- end }}
