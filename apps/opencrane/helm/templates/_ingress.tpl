{{- define "opencrane.server.ingress" -}}
{{- if .Values.ingress.enabled -}}
{{- /*
Fixed-wildcard topology: the control plane is the FIXED super-operator host, distinct
from the org-wildcard base (`ingress.domain`). It serves at `ingress.controlPlaneHost`
when set, else the derived default `platform.<ingress.domain>` — never under the org
wildcard `*.<ingress.domain>`. See docs/agents/cluster-architecture.md → "Tenancy Model".
*/ -}}
{{- $host := .Values.ingress.controlPlaneHost | default (printf "platform.%s" .Values.ingress.domain) -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
    - hosts:
        - {{ $host | quote }}
      secretName: {{ .Values.ingress.tls.secretName | default "opencrane-wildcard-tls" }}
  {{- end }}
  rules:
    - host: {{ $host | quote }}
      http:
        paths:
          # Same-origin hosting: public-safe service health at /healthz, the OpenCrane API under /api, the
          # bounded channel SSE endpoint under /v1, and the org-admin SPA under /. One origin gives the channel
          # proxy first-party session cookies without CORS. Helm OWNS these rules,
          # so the frontend layer never has to kubectl-patch the Ingress out-of-band (that
          # patch fought `helm upgrade` via an SSA field-manager conflict and reverted on
          # every reconcile — see docs/optimalisation-plan.md §5).
          - path: /healthz
            pathType: Exact
            backend:
              service:
                name: {{ include "opencrane.fullname" . }}-opencrane-server
                port:
                  number: {{ .Values.clustertenantManager.service.port }}
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: {{ include "opencrane.fullname" . }}-opencrane-server
                port:
                  number: {{ .Values.clustertenantManager.service.port }}
          {{- if .Values.channelProxy.enabled }}
          - path: /v1/events
            pathType: Exact
            backend:
              service:
                name: {{ include "opencrane.fullname" . }}-channel-proxy
                port:
                  number: {{ .Values.channelProxy.service.port }}
          {{- end }}
          # `/` is always owned by the release-local OpenCrane SPA.
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "opencrane.fullname" . }}-opencrane-ui-spa
                port:
                  number: {{ .Values.controlPlaneSpa.service.port }}
{{- end }}
{{- end }}
