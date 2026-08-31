{{/* Resolve and validate the namespace containing only the preprocessing worker and zero-RBAC identity. */}}
{{- define "opencrane.artifactPreprocessor.namespace" -}}
{{- $workerNamespace := default (printf "%s-artifact-preprocessing" (include "opencrane.fullname" .) | trunc 63 | trimSuffix "-") .Values.artifactPreprocessor.namespace -}}
{{- if or (gt (len $workerNamespace) 63) (not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $workerNamespace)) -}}
{{- fail "artifactPreprocessor.namespace must be a valid DNS-label namespace of at most 63 characters" -}}
{{- end -}}
{{- if eq $workerNamespace .Release.Namespace -}}
{{- fail "artifactPreprocessor.namespace must remain distinct from the trusted server namespace" -}}
{{- end -}}
{{- $workerNamespace -}}
{{- end -}}

{{- define "opencrane.artifactPreprocessor.resources" -}}
{{- if .Values.artifactPreprocessor.enabled }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.artifactPreprocessor.image.digest) }}
{{- fail "artifactPreprocessor.enabled=true requires an immutable sha256 artifactPreprocessor.image.digest" }}
{{- end }}
{{- $workerNamespace := include "opencrane.artifactPreprocessor.namespace" . -}}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-preprocessor
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: artifact-preprocessor
  namespace: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-preprocessor
automountServiceAccountToken: false
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-artifact-preprocessor
  namespace: {{ $workerNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-preprocessor
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: artifact-preprocessor
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress:
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
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
{{- end }}
{{- end }}
