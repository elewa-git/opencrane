{{- define "opencrane.server.rbac" -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
{{- /*
  Grant the OpenCrane server only over explicitly owned namespaces. A sibling artifact namespace
  is deliberately never listed here, so the catalog process cannot read its receipt-signing key.
*/}}
{{- $namespaces := include "opencrane.instanceNamespaces" . | fromJsonArray }}
{{- range $ns := $namespaces }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ include "opencrane.fullname" $ }}-opencrane-server
  namespace: {{ $ns }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
rules:
{{ include "opencrane.clustertenantManagerRbacRules" $ | nindent 2 }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ include "opencrane.fullname" $ }}-opencrane-server
  namespace: {{ $ns }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ include "opencrane.fullname" $ }}-opencrane-server
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" $ }}-opencrane-server
    namespace: {{ $.Release.Namespace }}
{{- end }}
---
{{- /*
  Stage 4: the silo READS the cluster-scoped ClusterTenant CR to resolve a host's per-org
  login client (per-org-client.ts: get by name, list by vanityDomain). ClusterTenant is
  cluster-scoped, so a get/list/watch grant cannot live in the namespaced Role above — it
  needs this minimal ClusterRole, rendered in BOTH modes. READ-ONLY: the fleet-manager owns
  ClusterTenant writes + provisioning; the silo never mutates the CR. (Platform-DNS / Zitadel
  cluster-scoped grants moved to fleet-manager-platform-dns-rbac.yaml + the fleet operator RBAC.)
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
{{- if and (eq (include "opencrane.deploymentMode" .) "standalone") .Values.clustertenantManager.standaloneSeed.name }}
---
{{- /*
  STANDALONE SELF-SEED ONLY: when CLUSTER_TENANT_SEED_NAME is set, there is no fleet-manager
  to create/bind this silo's own ClusterTenant CR. Grant only the verbs the boot seed uses:
  create the cluster-scoped CR and patch its status.boundNamespace/phase. Fleet-managed silos
  stay read-only via the role above.
*/}}
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ct-seed-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
rules:
  - apiGroups: ["opencrane.io"]
    resources: ["clustertenants"]
    verbs: ["create"]
  - apiGroups: ["opencrane.io"]
    resources: ["clustertenants/status"]
    resourceNames: [{{ .Values.clustertenantManager.standaloneSeed.name | quote }}]
    verbs: ["patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ct-seed-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ct-seed-{{ .Release.Namespace }}
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" . }}-opencrane-server
    namespace: {{ .Release.Namespace }}
{{- end }}
{{- if .Values.clustertenantManager.manageTenantNamespaces }}
---
{{- /*
  STANDALONE ONLY (clustertenantManager.manageTenantNamespaces=true): grant the silo the
  cluster-scoped `namespaces` verbs it needs to create + PSA-label each ClusterTenant's namespace
  itself. In the default fleet-managed topology this block is NOT rendered — the fleet-manager owns
  namespace creation and the silo skips it (MANAGE_TENANT_NAMESPACES=false), so the silo never holds
  this grant. Namespaces are cluster-scoped, so this cannot be a namespaced Role. Kept minimal — no
  delete (teardown is the fleet's / a human's call): get/list/watch/create/patch only.
*/}}
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ns-manage-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
rules:
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch", "create", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ns-manage-{{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "opencrane.fullname" . }}-opencrane-server-ns-manage-{{ .Release.Namespace }}
subjects:
  - kind: ServiceAccount
    name: {{ include "opencrane.fullname" . }}-opencrane-server
    namespace: {{ .Release.Namespace }}
{{- end }}
{{- end }}
