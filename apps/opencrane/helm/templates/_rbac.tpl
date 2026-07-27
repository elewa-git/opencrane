{{- define "opencrane.server.rbac" -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
---
# TokenReview is cluster-scoped and is required only for projected workload credentials on
# internal pod-identity routes. The runtime ServiceAccount receives no Kubernetes RBAC at all.
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
