{{- define "opencrane.server.networkPolicy" -}}
{{- if .Values.networkPolicy.enabled }}
# Ingress policy for the opencrane-ui service.
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
#   The operator's own /api/internal/tenant-models fetch is a localhost call within the
#   opencrane-ui pod, so it is not subject to this NetworkPolicy at all.
#
# NetworkPolicy cannot filter by URL path — the path/port split IS the boundary: internal
# routes only exist on the internal port, and only known platform pods may reach it.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ingress
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
