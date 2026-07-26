{{- define "opencrane.server.networkPolicy" -}}
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
#       - Tenant pods: /api/internal/contract/:name (runtime-contract re-pull; TokenReview
#         inside the handler is the identity check, this is defence-in-depth).
#       - Per-attempt agent-runtime Job: outbound `/api/internal/agent-runtime/*` only; its projected
#         ServiceAccount token is TokenReviewed inside the route, so this rule is only the L3/4 floor.
#   The operator's own /api/internal/tenant-models fetch is a localhost call within the
#   opencrane-ui pod, so it is not subject to this NetworkPolicy at all.
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
    # The personal-agent runtime owns no listener and can only initiate this connection.
    # TokenReview fixes its exact projected-token audience and ServiceAccount subject in-process.
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
    # Allow tenant pods to poll /api/internal/contract/:name on the INTERNAL port for
    # runtime-contract re-pull (P4A.3). Identity is enforced by TokenReview inside the
    # handler; this policy is defence-in-depth at the network layer.
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: tenant
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
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
    - to:
        - podSelector:
            matchLabels:
              cnpg.io/poolerName: {{ include "opencrane.postgresPoolerName" . }}
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
    # Cluster DNS lives outside the release namespace.
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
    {{- if .Values.clustertenantManager.cognee.install }}
    # Release-local durable memory and permission synchronization. BYO Cognee is
    # expected to use HTTPS and is therefore covered by the port-443 rule above.
    - to:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: cognee
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.cognee.service.port }}
    {{- end }}
    # The in-process gateway proxy connects directly to tenant Services.
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: tenant
      ports:
        - protocol: TCP
          port: {{ .Values.tenant.gatewayPort }}
    {{- if .Values.langfuse.inCluster.enabled }}
    # Release-local Langfuse metrics and trace API.
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: langfuse
              app.kubernetes.io/instance: {{ .Release.Name }}
              app: web
      ports:
        - protocol: TCP
          port: 3000
    {{- end }}
    {{- if .Values.observability.otel.enabled }}
    # Release-local OTEL collector for trace export.
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
    {{- if eq .Values.hosting.provider "gcp" }}
    # GKE Workload Identity token exchange before GCS HTTPS calls.
    - to:
        - ipBlock:
            cidr: 169.254.169.254/32
      ports:
        - protocol: TCP
          port: 80
    {{- end }}
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
{{- end }}
