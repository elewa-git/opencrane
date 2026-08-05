{{/*
Expand the name of the chart.
*/}}
{{- define "opencrane.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "opencrane.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "opencrane.labels" -}}
helm.sh/chart: {{ include "opencrane.name" . }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: opencrane
{{- end }}

{{/*
Selector labels for a component
*/}}
{{- define "opencrane.selectorLabels" -}}
app.kubernetes.io/name: {{ include "opencrane.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Resolve the exact CNPG-managed Pooler identity used by application egress rules.
The database release normally follows `<application release>-postgres`, while
recovery validation deliberately points an application release at a separately
named restored database. Deploy paths must override this value in that case.
*/}}
{{- define "opencrane.postgresPoolerName" -}}
{{- if .Values.networkPolicy.postgresPoolerName -}}
{{- .Values.networkPolicy.postgresPoolerName -}}
{{- else -}}
{{- printf "%s-postgres-pooler" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{/*
Resolve deployment environment for validation rules.
*/}}
{{- define "opencrane.environment" -}}
{{- default "dev" .Values.global.environment | lower -}}
{{- end }}

{{/*
DATABASE_URL env entry for the opencrane-ui main container.

Both roles wire the opencrane-ui to the database the installer provisions via
`controlPlane.database.existingSecret` (or `.url`). Per-ClusterTenant isolation (S6 / ADR 0002)
comes from the SILO deploying one dedicated CNPG server IN ITS OWN NAMESPACE. That server has
separate logical databases and credentials per plane; this helper receives only the OpenCrane
database Secret, so the silo opencrane-ui never shares a database role or needs to infer a tenant.
The deploy scripts (`apps/_infra/deploy-k8s/deploy.sh` → `k8s-deploy.sh`) provision the server +
per-database Secrets; this helper just consumes the OpenCrane one for both roles.

With no explicit DB this renders no DATABASE_URL (the opencrane-ui stays in its no-DB mode); a
real deploy always supplies one.
*/}}
{{- define "opencrane.clustertenantManagerDatabaseEnv" -}}
{{- $db := .Values.clustertenantManager.database | default dict -}}
{{- if $db.existingSecret -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ $db.existingSecret }}
      key: {{ $db.secretKey }}
{{- else if $db.url -}}
- name: DATABASE_URL
  value: {{ $db.url | quote }}
{{- end -}}
{{- end }}

{{/*
Resolve the namespace(s) a multi-instance install owns for namespaced RBAC.
Defaults to the release namespace when `multiInstance.instanceNamespaces` is empty.
*/}}
{{- define "opencrane.instanceNamespaces" -}}
{{- $mi := .Values.multiInstance | default dict -}}
{{- $ns := $mi.instanceNamespaces | default (list) -}}
{{- if $ns -}}
{{- $ns | toJson -}}
{{- else -}}
{{- list .Release.Namespace | toJson -}}
{{- end -}}
{{- end }}

{{/*
OpenCrane server RBAC is always namespaced. The clean target never grants this workload a
cluster-wide Secret read path: artifact-service keeps its receipt signer in a sibling namespace.
*/}}
{{- define "opencrane.namespacedRbac" -}}
true
{{- end }}

{{/*
Shared `spec:` body for a self-managed cert-manager Issuer/ClusterIssuer (#151 item 2),
reused by cluster-issuer.yaml for BOTH the namespaced-Issuer and cluster-singleton-
ClusterIssuer branches so the two can never drift. Takes a dict `{ cm, ingress }` (the
`certManager` and `ingress` values blocks) since a named template only receives one arg.

Every Certificate expected to reference this Issuer in a silo chart is a SINGLE,
non-wildcard hostname (the opencrane-ui's own host + an optional per-org vanity host —
see docs/agents/cluster-architecture.md → "Tenancy Model"), so HTTP-01 through the ingress
is sufficient on its own and is the default/only solver in acme mode. DNS-01 is layered in
ADDITIONALLY (scoped to `ingress.domain`) only when `certManager.acme.dns01.provider` is
set, for installs that prefer it.
*/}}
{{- define "opencrane.certIssuerSpec" -}}
{{- $cm := .cm -}}
{{- $ingress := .ingress -}}
{{- if eq $cm.mode "selfSigned" }}
selfSigned: {}
{{- else }}
acme:
  server: {{ $cm.acme.server | quote }}
  email: {{ $cm.acme.email | quote }}
  privateKeySecretRef:
    name: {{ $cm.acme.privateKeySecretName | quote }}
  solvers:
    {{- if $cm.acme.dns01.provider }}
    # DNS-01, scoped to the platform base domain — opt-in (certManager.acme.dns01.provider).
    - selector:
        dnsZones:
          - {{ $ingress.domain | quote }}
      dns01:
        {{- if eq $cm.acme.dns01.provider "clouddns" }}
        cloudDNS:
          {{- toYaml $cm.acme.dns01.config | nindent 10 }}
        {{- else }}
        {{ $cm.acme.dns01.provider }}:
          {{- toYaml $cm.acme.dns01.config | nindent 10 }}
        {{- end }}
    {{- end }}
    # HTTP-01 (default/catch-all) — every Certificate referencing this Issuer in this chart
    # is a single, non-wildcard host reachable through the ingress, so no DNS-provider
    # credentials are required for the common case.
    - http01:
        ingress:
          ingressClassName: {{ $ingress.className | default "nginx" | quote }}
{{- end }}
{{- end }}

{{/*
sharedPlatform scope resolution (multi-instance blocker B5).

`opencrane.<component>Shared` returns the literal string "true" when a component is
configured as `shared` (an external, centrally-operated endpoint serves all
instances), and "" (falsey) otherwise. Default for every component is `instance`, so
an absent or partial `sharedPlatform` block preserves today's release-local behaviour.

`opencrane.<component>Url` / `opencrane.obotSecretName` resolve the endpoint/name the
consumers should use:
  - instance mode → release-prefixed in-cluster name (current behaviour).
  - shared mode   → the externally-provided value, failing fast if it is unset.
*/}}

{{- define "opencrane.litellmShared" -}}
{{- $sp := .Values.sharedPlatform | default dict -}}
{{- $c := $sp.litellm | default dict -}}
{{- if eq (default "instance" $c.mode) "shared" -}}true{{- end -}}
{{- end }}

{{- define "opencrane.mcpGatewayShared" -}}
{{- $sp := .Values.sharedPlatform | default dict -}}
{{- $c := $sp.mcpGateway | default dict -}}
{{- if eq (default "instance" $c.mode) "shared" -}}true{{- end -}}
{{- end }}

{{- define "opencrane.externalSecretsShared" -}}
{{- $sp := .Values.sharedPlatform | default dict -}}
{{- $c := $sp.externalSecrets | default dict -}}
{{- if eq (default "instance" $c.mode) "shared" -}}true{{- end -}}
{{- end }}

{{/*
LiteLLM base endpoint the operator and opencrane-ui should call.
instance → release-local Service; shared → sharedPlatform.litellm.shared.endpoint.
*/}}
{{- define "opencrane.litellmEndpoint" -}}
{{- if eq (include "opencrane.litellmShared" .) "true" -}}
{{- $ep := .Values.sharedPlatform.litellm.shared.endpoint | default "" -}}
{{- if not $ep -}}{{- fail "sharedPlatform.litellm.mode=shared requires sharedPlatform.litellm.shared.endpoint" -}}{{- end -}}
{{- $ep -}}
{{- else -}}
{{- printf "http://%s-litellm:%v" (include "opencrane.fullname" .) .Values.litellm.service.port -}}
{{- end -}}
{{- end }}

{{/*
Obot MCP gateway base URL the operator injects into tenant runtimes.
instance → release-local Service; shared → sharedPlatform.mcpGateway.shared.url.
*/}}
{{- define "opencrane.mcpGatewayUrl" -}}
{{- if eq (include "opencrane.mcpGatewayShared" .) "true" -}}
{{- $u := .Values.sharedPlatform.mcpGateway.shared.url | default "" -}}
{{- if not $u -}}{{- fail "sharedPlatform.mcpGateway.mode=shared requires sharedPlatform.mcpGateway.shared.url" -}}{{- end -}}
{{- $u -}}
{{- else -}}
{{- printf "http://%s-mcp-gateway:%v" (include "opencrane.fullname" .) .Values.mcpGateway.service.port -}}
{{- end -}}
{{- end }}

{{/* Release-local Cognee endpoint the private memory gateway should call. */}}
{{- define "opencrane.cogneeEndpoint" -}}
{{- $c := .Values.clustertenantManager.cognee | default dict -}}
{{- printf "http://%s-cognee.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace $c.service.port -}}
{{- end }}

{{/*
Release-local private memory-gateway origin the OpenCrane server calls with its projected
`opencrane-memory-gateway` audience token. Always the in-release Service; the gateway is the
only permitted Cognee caller, so the server never receives a Cognee endpoint directly.
*/}}
{{- define "opencrane.memoryGatewayUrl" -}}
{{- printf "http://%s-memory-gateway.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.memoryGateway.service.port -}}
{{- end }}

{{/*
Name of the Secret holding Obot's PostgreSQL DSN (key `dsn`).
instance → release-prefixed `<fullname>-obot` (per-instance, collision-free; B5).
shared   → the operator points at an external Obot, so no in-release Secret is used.
This Secret is provisioned out-of-band (operator/installer), not by the chart.
*/}}
{{- define "opencrane.obotSecretName" -}}
{{- printf "%s-obot" (include "opencrane.fullname" .) -}}
{{- end }}

{{/*
Observability env block for an app container.

Call with a dict carrying the root context + the logical service name, e.g.:
  {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "clustertenant-manager") | nindent 12 }}

NODE_ENV + LOG_LEVEL are always emitted so logs are consistent JSON. The OTEL_*
vars are emitted only when observability.otel.enabled, pointing apps at the
operator-supplied release-local collector Service; omitting them leaves @opencrane/backend/observability's
startTelemetry a no-op (it keys off OTEL_EXPORTER_OTLP_ENDPOINT). The service name
is also set in code, so this stays correct even if the env var is dropped. This chart
does not deploy the operator-supplied collector.
*/}}
{{- define "opencrane.observabilityEnv" -}}
{{- $ctx := .ctx -}}
{{- $component := .component -}}
{{- $o := $ctx.Values.observability | default dict -}}
{{- $otel := $o.otel | default dict -}}
{{- $collector := $otel.collector | default dict -}}
- name: NODE_ENV
  value: {{ default "production" $otel.nodeEnv | quote }}
- name: LOG_LEVEL
  value: {{ default "info" $otel.logLevel | quote }}
{{- if $otel.enabled }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: "http://{{ include "opencrane.fullname" $ctx }}-otel-collector.{{ $ctx.Release.Namespace }}.svc:{{ default 4318 $collector.otlpPort }}"
- name: OTEL_EXPORTER_OTLP_PROTOCOL
  value: "http/protobuf"
- name: OTEL_SERVICE_NAME
  value: {{ $component | quote }}
- name: OTEL_RESOURCE_ATTRIBUTES
  value: "service.namespace=opencrane,deployment.environment={{ include "opencrane.environment" $ctx }}"
{{- end }}
{{- end }}

{{/*
Validation guardrails for sensitive LiteLLM configuration.
*/}}
{{- define "opencrane.validate" -}}
{{- $env := include "opencrane.environment" . -}}
{{- if and .Values.litellm.enabled (not (or (eq $env "dev") (eq $env "development"))) -}}
	{{- $usingExistingSecret := not (empty .Values.litellm.existingSecret) -}}
	{{- $generateMasterKey := true -}}
	{{- if hasKey .Values.litellm "generateMasterKey" -}}
		{{- $generateMasterKey = .Values.litellm.generateMasterKey -}}
	{{- end -}}
	{{- $masterKey := default "" .Values.litellm.masterKey -}}
	{{- $placeholder := "change-me-in-production" -}}
	{{- if and (not $usingExistingSecret) (not $generateMasterKey) (or (empty $masterKey) (eq $masterKey $placeholder)) -}}
		{{- fail "LiteLLM is enabled in non-dev environment, but no secure master key is configured. Set litellm.existingSecret, set litellm.generateMasterKey=true, or provide a non-placeholder litellm.masterKey." -}}
	{{- end -}}
{{- end -}}
{{- end }}
