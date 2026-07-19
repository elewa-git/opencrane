{{- define "opencrane.agentRuntime.resources" -}}
{{- if .Values.agentRuntime.enabled }}
{{- $fullName := include "opencrane.fullname" . -}}
{{- $namespace := default .Release.Namespace .Values.agentRuntime.namespace -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ required "agentRuntime.serviceAccountName is required when agentRuntime.enabled=true" .Values.agentRuntime.serviceAccountName }}
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
automountServiceAccountToken: false
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $fullName }}-agent-runtime
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: agent-runtime
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress:
    # Phase D has no proof-bound bootstrap listener. Do not grant this inert Job access to
    # the shared internal port: NetworkPolicy cannot distinguish bootstrap routes from other
    # internal endpoints. Phase E adds one dedicated listener and an exact egress rule together.
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
---
# Cilium enforces the same default-deny runtime profile using immutable workload and
# ServiceAccount identity. This intentionally grants no OpenCrane API access until the
# proof-bound runtime listener is introduced with its own exact policy.
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: {{ $fullName }}-agent-runtime
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  endpointSelector:
    matchLabels:
      "k8s:app.kubernetes.io/name": {{ include "opencrane.name" . | quote }}
      "k8s:app.kubernetes.io/instance": {{ .Release.Name | quote }}
      "k8s:app.kubernetes.io/component": agent-runtime
      "io.cilium.k8s.policy.serviceaccount": {{ .Values.agentRuntime.serviceAccountName | quote }}
  egress:
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace": kube-system
            "k8s:k8s-app": kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
            - port: "53"
              protocol: TCP
    {{- if .Values.observability.otel.enabled }}
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace": {{ $namespace | quote }}
            "k8s:app.kubernetes.io/component": otel-collector
      toPorts:
        - ports:
            - port: {{ .Values.observability.otel.collector.otlpPort | quote }}
              protocol: TCP
    {{- end }}
{{- end }}
{{- end }}
