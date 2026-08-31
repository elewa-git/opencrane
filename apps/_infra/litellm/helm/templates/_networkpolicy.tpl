{{/*
This template renders LiteLLM's base boundary for its release-local callers and outbound paths.
The agent-controller adds claimed warm runtimes separately because it owns their pool selectors.
The chart rejects Redis while no app-owned policy can select its workload.
Called by apps/_infra/deploy-k8s/templates/app-rollups.yaml.
*/}}
{{- define "opencrane.litellm.networkPolicy" -}}
{{- $localLiteLlm := and .Values.litellm.enabled (ne (include "opencrane.litellmShared" .) "true") -}}
{{- $policyRequired := or .Values.networkPolicy.enabled .Values.agentController.enabled -}}
{{- if and $localLiteLlm $policyRequired .Values.litellm.redis.enabled -}}
{{- fail "litellm.redis.enabled=true is unsupported while the app-owned LiteLLM NetworkPolicy is active because no exact Redis workload boundary is configured" -}}
{{- end -}}
{{- if and $localLiteLlm $policyRequired }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-litellm
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: litellm
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: litellm
  policyTypes: ["Ingress", "Egress"]
  ingress:
    # The release-local server and Cognee are the two long-lived model-routing callers.
    # The agent-controller's additive policy admits claimed warm runtimes without widening this rule.
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: cognee
      ports:
        - protocol: TCP
          port: {{ .Values.litellm.service.port }}
  egress:
    # GKE Dataplane V2 may enforce this rule after Service translation. Keep the source on the
    # database port while the CNPG Pooler's own ingress policy selects this exact LiteLLM Pod.
    - ports:
        - protocol: TCP
          port: 5432
    {{- if .Values.networkPolicy.allowDNS }}
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    {{- end }}
    # Provider APIs use TLS. FQDN narrowing requires a separately qualified policy API.
    - ports:
        - protocol: TCP
          port: 443
{{- end }}
{{- end }}
