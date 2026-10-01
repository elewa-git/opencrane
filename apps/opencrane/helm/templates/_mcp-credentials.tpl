{{/* Bind the credential namespace to both Helm release coordinates without truncation collisions. */}}
{{- define "opencrane.server.mcpCredentialNamespace" -}}
{{- $releaseDigest := printf "%s/%s" .Release.Namespace .Release.Name | sha256sum | trunc 10 -}}
{{- printf "%s-mcp-%s" (.Release.Namespace | trunc 40 | trimSuffix "-") $releaseDigest -}}
{{- end -}}

{{- define "opencrane.server.mcpCredentialCustody" -}}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ include "opencrane.server.mcpCredentialNamespace" . }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: mcp-credential-custody
---
# Credentials need dynamic names. Keep that access in a namespace with no other secrets or Pods.
apiVersion: v1
kind: ResourceQuota
metadata:
  name: no-workloads
  namespace: {{ include "opencrane.server.mcpCredentialNamespace" . }}
spec:
  hard:
    count/pods: "0"
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: mcp-credential-custody
  namespace: {{ include "opencrane.server.mcpCredentialNamespace" . }}
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create", "get", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: mcp-credential-custody
  namespace: {{ include "opencrane.server.mcpCredentialNamespace" . }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: mcp-credential-custody
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" . }}-opencrane-server
    namespace: {{ .Release.Namespace }}
{{- end -}}
