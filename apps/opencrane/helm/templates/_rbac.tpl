{{- define "opencrane.server.rbac" -}}
{{- $managedPlane := (index .Values "managedAgentRuntimePlane").managedAgentRuntime -}}
{{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") $managedPlane.namespace -}}
{{- $runtimeNamespaces := list (include "opencrane.agentController.runtimeNamespace" .) $managedRuntimeNamespace -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
# The server TokenReviews workload callers and performs fenced Kubernetes cleanup, so it needs its
# own API token. Memory access uses the separate projected audience in the Deployment instead.
automountServiceAccountToken: true
{{- range $runtimeNamespace := $runtimeNamespaces }}
---
# Runtime cleanup is server-fenced in Postgres first. This Role grants only the physical
# observation and UID-preconditioned deletion required after that durable claim exists.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ printf "%s-runtime-cleanup" (include "opencrane.fullname" $) | trunc 63 | trimSuffix "-" }}
  namespace: {{ $runtimeNamespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ printf "%s-runtime-cleanup" (include "opencrane.fullname" $) | trunc 63 | trimSuffix "-" }}
  namespace: {{ $runtimeNamespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ printf "%s-runtime-cleanup" (include "opencrane.fullname" $) | trunc 63 | trimSuffix "-" }}
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" $ }}-opencrane-server
    namespace: {{ $.Release.Namespace }}
{{- end }}
---
# TokenReview is cluster-scoped and is required only for projected workload credentials on
# internal pod-identity routes. Runtime Job ServiceAccounts receive no Kubernetes RBAC at all.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-tokenreview-{{ .Release.Namespace }}
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
  name: {{ include "opencrane.fullname" . }}-opencrane-server-tokenreview-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "opencrane.fullname" . }}-opencrane-server-tokenreview-{{ .Release.Namespace }}
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" . }}-opencrane-server
    namespace: {{ .Release.Namespace }}
{{- /*
  Per-org OIDC login may read the ClusterTenant host/client binding. It never mutates the CR.
*/}}
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  # Cluster-scoped → suffix per silo (see the opencrane-server ClusterRole above).
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ct-read-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
rules:
  - apiGroups: ["opencrane.io"]
    resources: ["clustertenants"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ct-read-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ct-read-{{ .Release.Namespace }}
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" . }}-opencrane-server
    namespace: {{ .Release.Namespace }}
{{- end }}
