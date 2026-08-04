{{- define "opencrane.obot.networkPolicy" -}}
{{- if and .Values.networkPolicy.enabled .Values.mcpGateway.enabled (ne (include "opencrane.mcpGatewayShared" .) "true") }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-mcp-gateway-ingress
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: mcp-gateway
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: mcp-gateway
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: tenant
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ .Values.mcpGateway.service.port }}
    {{- if .Values.agentController.enabled }}
    # Direct approved tool invocation from the two isolated runtime planes. Network reach is only
    # the L3/4 floor: Obot authorises each call with the attempt-scoped, server-scoped API key.
    {{- $personalRuntimeNamespace := include "opencrane.agentController.runtimeNamespace" . }}
    {{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") .Values.managedAgentRuntimePlane.managedAgentRuntime.namespace }}
    - from:
        {{- range $runtimeNamespace := (list $personalRuntimeNamespace $managedRuntimeNamespace) }}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $runtimeNamespace | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: agent-runtime
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.mcpGateway.service.port }}
    {{- end }}
---
{{- end }}
{{- end }}
