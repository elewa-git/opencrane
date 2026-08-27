{{- define "opencrane.server.deployment" -}}
{{- $managedPlane := (index .Values "managedAgentRuntimePlane").managedAgentRuntime -}}
{{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") $managedPlane.namespace -}}
{{- $membership := .Values.clustertenantManager.membership -}}
{{- $standaloneMembership := $membership.standalone -}}
{{- $fleetMembership := $membership.fleet -}}
{{- $initialModel := .Values.clustertenantManager.initialModel -}}
{{- $firstUser := .Values.clustertenantManager.firstUser -}}
{{- $ociRegistry := .Values.clustertenantManager.workflows.ociRegistry -}}
{{- $ociRegistryAuthorization := $ociRegistry.authorization -}}
{{- $mcpExecutor := (index .Values "opencrane-mcp-executor").mcpExecutor -}}
{{- $controlPlaneHost := .Values.ingress.controlPlaneHost | default (printf "platform.%s" .Values.ingress.domain) -}}
{{- $channelSiloId := .Values.channelProxy.siloId | default $firstUser.clusterTenant | default .Release.Name -}}
{{- $openCraneInternalUrl := .Values.channelProxy.openCraneInternalUrl | default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort) -}}
{{- if not (or (eq $membership.mode "standalone") (eq $membership.mode "fleet")) -}}
{{- fail "clustertenantManager.membership.mode must be standalone or fleet" -}}
{{- end -}}
{{- if and (eq $membership.mode "standalone") (empty $standaloneMembership.invitationSigningExistingSecret) -}}
{{- fail "clustertenantManager.membership.standalone.invitationSigningExistingSecret is required in standalone mode" -}}
{{- end -}}
{{- if and (eq $membership.mode "standalone") (empty $standaloneMembership.invitationSigningKeyKey) -}}
{{- fail "clustertenantManager.membership.standalone.invitationSigningKeyKey is required in standalone mode" -}}
{{- end -}}
{{- if and (eq $membership.mode "fleet") (empty $fleetMembership.billingGatewayUrl) -}}
{{- fail "clustertenantManager.membership.fleet.billingGatewayUrl is required in fleet mode" -}}
{{- end -}}
{{- if and (eq $membership.mode "fleet") (not (hasPrefix "https://" $fleetMembership.billingGatewayUrl)) -}}
{{- fail "clustertenantManager.membership.fleet.billingGatewayUrl must use https" -}}
{{- end -}}
{{- if and (eq $membership.mode "fleet") (empty $fleetMembership.billingGatewayCredentialSiloId) -}}
{{- fail "clustertenantManager.membership.fleet.billingGatewayCredentialSiloId is required in fleet mode" -}}
{{- end -}}
{{- if and (eq $membership.mode "fleet") (empty $fleetMembership.billingGatewayProjectedTokenAudience) -}}
{{- fail "clustertenantManager.membership.fleet.billingGatewayProjectedTokenAudience is required in fleet mode" -}}
{{- end -}}
{{- if and (eq $membership.mode "fleet") (or (lt (int $fleetMembership.billingGatewayProjectedTokenTtlSeconds) 600) (gt (int $fleetMembership.billingGatewayProjectedTokenTtlSeconds) 3600)) -}}
{{- fail "clustertenantManager.membership.fleet.billingGatewayProjectedTokenTtlSeconds must be from 600 through 3600" -}}
{{- end -}}
{{- if ne (empty $initialModel.provider) (empty $initialModel.existingSecret) -}}
{{- fail "clustertenantManager.initialModel.provider and existingSecret must be configured together" -}}
{{- end -}}
{{- if and $initialModel.provider (empty $initialModel.apiKeySecretKey) -}}
{{- fail "clustertenantManager.initialModel.apiKeySecretKey is required when an initial model is configured" -}}
{{- end -}}
{{- if ne (empty $firstUser.email) (empty $firstUser.clusterTenant) -}}
{{- fail "clustertenantManager.firstUser.email and clusterTenant must be configured together" -}}
{{- end -}}
{{- if and $firstUser.email (ne $membership.mode "standalone") -}}
{{- fail "clustertenantManager.firstUser requires membership.mode=standalone" -}}
{{- end -}}
{{- if not (hasPrefix "https://" $ociRegistry.baseUrl) -}}
{{- fail "clustertenantManager.workflows.ociRegistry.baseUrl must use https" -}}
{{- end -}}
{{- if empty $ociRegistry.repository -}}
{{- fail "clustertenantManager.workflows.ociRegistry.repository is required" -}}
{{- end -}}
{{- if and $ociRegistryAuthorization.existingSecret (empty $ociRegistryAuthorization.secretKey) -}}
{{- fail "clustertenantManager.workflows.ociRegistry.authorization.secretKey is required when an existingSecret is configured" -}}
{{- end -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
spec:
  replicas: {{ .Values.clustertenantManager.replicas }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: opencrane-server
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: opencrane-server
    spec:
      serviceAccountName: {{ include "opencrane.fullname" . }}-opencrane-server
      {{- with .Values.global.imagePullSecret }}
      imagePullSecrets:
        - name: {{ . | quote }}
      {{- end }}
      securityContext:
        {{- toYaml .Values.clustertenantManager.podSecurityContext | nindent 8 }}
      containers:
        - name: opencrane-ui
          image: "{{ .Values.clustertenantManager.image.repository }}:{{ .Values.clustertenantManager.image.tag }}"
          imagePullPolicy: {{ .Values.clustertenantManager.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.clustertenantManager.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: {{ .Values.clustertenantManager.service.port }}
            # Internal-only API listener (/api/internal/*) — separate socket, off the ingress.
            - name: internal
              containerPort: {{ .Values.clustertenantManager.service.internalPort }}
          env:
            - name: NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: PORT
              value: {{ .Values.clustertenantManager.service.port | quote }}
            # Second (internal-only) listener for /api/internal/*.
            - name: INTERNAL_PORT
              value: {{ .Values.clustertenantManager.service.internalPort | quote }}
            {{- if .Values.channelProxy.enabled }}
            # Stable receiver identity and exact per-release target. Startup reconciles one distinct
            # route row per AgentService; the receiver id is never reused as a route-row id.
            - name: CHANNEL_PROXY_SERVICE_ACCOUNT_NAME
              value: {{ printf "%s-channel-proxy" (include "opencrane.fullname" .) | quote }}
            - name: CHANNEL_TARGET_TRUSTED_HOST
              value: {{ $controlPlaneHost | quote }}
            - name: CHANNEL_TARGET_SILO_ID
              value: {{ $channelSiloId | quote }}
            - name: CHANNEL_REPLAY_RECEIVER_ID
              value: {{ required "channelProxy.replayReceiverId is required when channelProxy is enabled" .Values.channelProxy.replayReceiverId | quote }}
            - name: CHANNEL_REPLAY_ENDPOINT
              value: {{ printf "%s/api/internal/conversation-replay" (trimSuffix "/" $openCraneInternalUrl) | quote }}
            - name: CHANNEL_INVOCATION_CONTEXT_TTL_SECONDS
              value: {{ .Values.channelProxy.invocationContextTtlSeconds | quote }}
            - name: CHANNEL_PROXY_URL
              value: {{ printf "http://%s-channel-proxy.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.channelProxy.service.port | quote }}
            {{- end }}
            - name: AGENT_CONTROLLER_CLAIM_LEASE_SECONDS
              value: {{ .Values.agentController.claimLeaseSeconds | quote }}
            - name: AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS
              value: {{ .Values.agentController.assignmentTtlSeconds | quote }}
            - name: AGENT_RUNTIME_OUTBOX_RETENTION_SECONDS
              value: {{ .Values.agentController.outboxRetentionSeconds | quote }}
            - name: AGENT_RUNTIME_OUTBOX_PRUNE_BATCH_SIZE
              value: {{ .Values.agentController.outboxPruneBatchSize | quote }}
            - name: AGENT_RUN_ADMISSION_MAX_CONCURRENT
              value: {{ .Values.clustertenantManager.runAdmission.maxConcurrent | quote }}
            - name: AGENT_RUN_ADMISSION_MAX_QUEUED
              value: {{ .Values.clustertenantManager.runAdmission.maxQueued | quote }}
            # Absurd runs saved control-plane tasks from the same silo database used by product writes.
            - name: OPENCRANE_SILO_ID
              value: {{ $channelSiloId | quote }}
            - name: OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE
              value: {{ .Values.clustertenantManager.workflows.databasePoolSize | quote }}
            - name: OPENCRANE_WORKFLOW_WORKER_CONCURRENCY
              value: {{ .Values.clustertenantManager.workflows.workerConcurrency | quote }}
            - name: OPENCRANE_WORKFLOW_POLL_INTERVAL_MS
              value: {{ .Values.clustertenantManager.workflows.pollIntervalMilliseconds | quote }}
            - name: OPENCRANE_MCP_ERA_PROBE_TIMEOUT_MS
              value: {{ .Values.clustertenantManager.workflows.mcpEraProbeTimeoutMilliseconds | quote }}
            - name: OPENCRANE_MCP_ERA_PROBE_MAX_RESPONSE_BYTES
              value: {{ .Values.clustertenantManager.workflows.mcpEraProbeMaximumResponseBytes | quote }}
            - name: OPENCRANE_OCI_REGISTRY_BASE_URL
              value: {{ $ociRegistry.baseUrl | quote }}
            - name: OPENCRANE_OCI_REGISTRY_REPOSITORY
              value: {{ $ociRegistry.repository | quote }}
            - name: OPENCRANE_OCI_REGISTRY_TIMEOUT_MS
              value: {{ $ociRegistry.requestTimeoutMilliseconds | quote }}
            {{- if $ociRegistryAuthorization.existingSecret }}
            - name: OPENCRANE_OCI_REGISTRY_AUTHORIZATION_FILE
              value: /var/run/opencrane/oci-registry/authorization
            {{- end }}
            - name: OPENCRANE_MEMBERSHIP_MODE
              value: {{ $membership.mode | quote }}
            - name: OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS
              value: {{ $membership.maximumStalenessMs | quote }}
            {{- if eq $membership.mode "standalone" }}
            - name: OPENCRANE_INVITATION_SIGNING_KEY_PATH
              value: /var/run/opencrane/invitation-signing/key
            - name: OPENCRANE_PUBLIC_BASE_URL
              value: {{ $standaloneMembership.publicBaseUrl | default (printf "https://%s" $controlPlaneHost) | quote }}
            - name: OPENCRANE_INVITATION_TTL_SECONDS
              value: {{ $standaloneMembership.invitationTtlSeconds | quote }}
            {{- end }}
            {{- if $firstUser.email }}
            # One-time standalone owner admission stays subject-bound: email merely selects the
            # verified OIDC identity that may claim this release's local owner slot.
            - name: OPENCRANE_STANDALONE_FIRST_USER_EMAIL
              value: {{ $firstUser.email | quote }}
            - name: OPENCRANE_STANDALONE_CLUSTER_TENANT
              value: {{ $firstUser.clusterTenant | quote }}
            {{- end }}
            {{- if eq $membership.mode "fleet" }}
            - name: OPENCRANE_MEMBERSHIP_ISSUER_ID
              value: {{ required "clustertenantManager.membership.fleet.trustedIssuerId is required in fleet mode" $fleetMembership.trustedIssuerId | quote }}
            - name: OPENCRANE_MEMBERSHIP_KEY_ID
              value: {{ required "clustertenantManager.membership.fleet.issuerKeyId is required in fleet mode" $fleetMembership.issuerKeyId | quote }}
            - name: OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE
              value: /var/run/opencrane/membership/public-key.pem
            - name: OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_URL
              value: {{ $fleetMembership.billingGatewayUrl | quote }}
            - name: OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_SILO_ID
              value: {{ $fleetMembership.billingGatewayCredentialSiloId | quote }}
            - name: OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_TOKEN_PATH
              value: /var/run/opencrane/membership-billing/token
            - name: OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_TIMEOUT_SECONDS
              value: {{ $fleetMembership.billingGatewayTimeoutSeconds | quote }}
            {{- end }}
            # The server binds each runtime identity class to its own Helm-owned restricted namespace.
            - name: AGENT_RUNTIME_PERSONAL_NAMESPACE
              value: {{ include "opencrane.agentController.runtimeNamespace" . | quote }}
            - name: AGENT_RUNTIME_MANAGED_NAMESPACE
              value: {{ $managedRuntimeNamespace | quote }}
            # OCI-backed MCP calls use a separate Job class and Pod-bound companion identity.
            - name: MCP_EXECUTOR_NAMESPACE
              value: {{ $mcpExecutor.namespace | quote }}
            - name: MCP_CONTROLLER_CLAIM_LEASE_SECONDS
              value: {{ $mcpExecutor.controllerClaimLeaseSeconds | quote }}
            - name: MCP_COMPANION_CLAIM_LEASE_SECONDS
              value: {{ $mcpExecutor.companionClaimLeaseSeconds | quote }}
            # The preprocessing router TokenReviews only this Helm-owned worker namespace.
            - name: ARTIFACT_PREPROCESSOR_ENABLED
              value: {{ .Values.artifactPreprocessor.enabled | quote }}
            - name: ARTIFACT_PREPROCESSOR_NAMESPACE
              value: {{ include "opencrane.artifactPreprocessor.namespace" . | quote }}
            - name: ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES
              value: {{ .Values.artifactPreprocessor.maximumOutputBytes | quote }}
            # The scanner router TokenReviews only this separate Helm-owned worker namespace.
            - name: ARTIFACT_SCANNER_ENABLED
              value: {{ .Values.artifactScanner.enabled | quote }}
            - name: ARTIFACT_SCANNER_CLAIM_LEASE_SECONDS
              value: {{ .Values.artifactScanner.claimLeaseSeconds | quote }}
            - name: ARTIFACT_SCANNER_NAMESPACE
              value: {{ include "opencrane.artifactScanner.namespace" . | quote }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "opencrane-server") | nindent 12 }}
            {{- with .Values.clustertenantManager.oidc }}
            {{- if .issuerUrl }}
            # OIDC is the only public human-authentication path. When it is absent the API
            # remains fail-closed; the chart never enables a tokenless development setup.
            - name: OIDC_ISSUER_URL
              value: {{ .issuerUrl | quote }}
            - name: OIDC_CLIENT_ID
              value: {{ .clientId | quote }}
            - name: OIDC_REDIRECT_URI
              value: {{ .redirectUri | quote }}
            {{- if .existingSecret }}
            - name: OIDC_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ .existingSecret }}
                  key: {{ .clientSecretKey }}
            - name: OIDC_SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ .existingSecret }}
                  key: {{ .sessionSecretKey }}
            {{- else }}
            {{- if .clientSecret }}
            - name: OIDC_CLIENT_SECRET
              value: {{ .clientSecret | quote }}
            {{- end }}
            {{- if .sessionSecret }}
            - name: OIDC_SESSION_SECRET
              value: {{ .sessionSecret | quote }}
            {{- end }}
            {{- end }}
            {{- if .groupsClaim }}
            - name: OIDC_GROUPS_CLAIM
              value: {{ .groupsClaim | quote }}
            {{- end }}
            {{- if .rolesClaim }}
            - name: OIDC_ROLES_CLAIM
              value: {{ .rolesClaim | quote }}
            {{- end }}
            {{- if .platformOperatorGroups }}
            - name: OPENCRANE_PLATFORM_OPERATOR_GROUPS
              value: {{ .platformOperatorGroups | quote }}
            {{- end }}
            {{- if .orgAdminGroups }}
            - name: OPENCRANE_ORG_ADMIN_GROUPS
              value: {{ .orgAdminGroups | quote }}
            {{- end }}
            {{- if .platformOperatorSeedEmail }}
            # -- Per-cluster platform-operator SEED. A caller whose VERIFIED email equals
            #    this becomes a platform operator (OR-ed with the group check). Empty →
            #    rendered as no env var, so the seed grants operator to NOBODY (fail-closed).
            - name: OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL
              value: {{ .platformOperatorSeedEmail | quote }}
            {{- end }}
            {{- end }}
            {{- end }}
            # LiteLLM remains a target model-routing dependency.
            - name: LITELLM_ENDPOINT
              value: {{ include "opencrane.litellmEndpoint" . | quote }}
            - name: LITELLM_SPEND_PATH_TEMPLATE
              value: {{ .Values.litellm.spendPathTemplate | quote }}
            {{- if .Values.litellm.enabled }}
            - name: LITELLM_MASTER_KEY
              valueFrom:
                secretKeyRef:
                  {{- if .Values.litellm.existingSecret }}
                  name: {{ .Values.litellm.existingSecret }}
                  {{- else }}
                  name: {{ include "opencrane.fullname" . }}-litellm
                  {{- end }}
                  key: {{ .Values.litellm.secretKey }}
            {{- end }}
            {{- with $initialModel }}
            {{- if .provider }}
            # Deployment-time model bootstrap. The raw key remains in the provider custody Secret;
            # this process consumes it only to register LiteLLM's encrypted credential and catalog.
            - name: OPENCRANE_INITIAL_MODEL_PROVIDER
              value: {{ .provider | quote }}
            - name: OPENCRANE_INITIAL_MODEL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .existingSecret }}
                  key: {{ .apiKeySecretKey }}
            {{- end }}
            {{- end }}
            {{- include "opencrane.clustertenantManagerDatabaseEnv" . | nindent 12 }}
            # Server-owned Kubernetes operations are restricted to this release namespace.
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: ARTIFACT_SERVICE_URL
              value: {{ printf "http://%s-artifact-service.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) (default (printf "%s-artifacts" .Release.Namespace) .Values.artifactService.namespace) .Values.artifactService.service.port | quote }}
            - name: ARTIFACT_LEASE_PRIVATE_KEY_PATH
              value: /var/run/opencrane/artifact-keys/lease-private.pem
            - name: ARTIFACT_RECEIPT_PUBLIC_KEY_PATH
              value: /var/run/opencrane/artifact-keys/receipt-public.pem
            # The private memory gateway is the server's only path to Cognee. The projected token
            # carries the gateway-only audience so no other server credential can open that plane.
            - name: MEMORY_GATEWAY_URL
              value: {{ include "opencrane.memoryGatewayUrl" . | quote }}
            - name: MEMORY_GATEWAY_TOKEN_PATH
              value: /var/run/opencrane/memory-gateway/token
            - name: MEMORY_GATEWAY_TIMEOUT_SECONDS
              value: {{ .Values.clustertenantManager.memoryGateway.httpTimeoutSeconds | quote }}
          volumeMounts:
            - name: artifact-keys
              mountPath: /var/run/opencrane/artifact-keys
              readOnly: true
            {{- if eq $membership.mode "standalone" }}
            - name: invitation-signing-key
              mountPath: /var/run/opencrane/invitation-signing
              readOnly: true
            {{- end }}
            {{- if eq $membership.mode "fleet" }}
            - name: membership-verification-key
              mountPath: /var/run/opencrane/membership
              readOnly: true
            - name: membership-billing-token
              mountPath: /var/run/opencrane/membership-billing
              readOnly: true
            {{- end }}
            - name: memory-gateway-token
              mountPath: /var/run/opencrane/memory-gateway
              readOnly: true
            {{- if $ociRegistryAuthorization.existingSecret }}
            - name: oci-registry-authorization
              mountPath: /var/run/opencrane/oci-registry
              readOnly: true
            {{- end }}
          livenessProbe:
            # A running server can repair a transient dependency connection; the
            # aggregated health route keeps database readiness as the public gate.
            # Liveness therefore proves only that the control-plane listener is
            # alive, rather than restarting it for an upstream dependency.
            tcpSocket:
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
          resources:
            {{- toYaml .Values.clustertenantManager.resources | nindent 12 }}
      volumes:
        - name: artifact-keys
          secret:
            secretName: {{ required "artifactService.keys.catalogExistingSecret is required" .Values.artifactService.keys.catalogExistingSecret | quote }}
            defaultMode: 0440
            items:
              - key: lease-private.pem
                path: lease-private.pem
              - key: receipt-public.pem
                path: receipt-public.pem
        {{- if eq $membership.mode "standalone" }}
        - name: invitation-signing-key
          secret:
            secretName: {{ $standaloneMembership.invitationSigningExistingSecret | quote }}
            defaultMode: 0440
            items:
              - key: {{ $standaloneMembership.invitationSigningKeyKey | quote }}
                path: key
        {{- end }}
        {{- if eq $membership.mode "fleet" }}
        - name: membership-verification-key
          secret:
            secretName: {{ required "clustertenantManager.membership.fleet.existingSecret is required in fleet mode" $fleetMembership.existingSecret | quote }}
            defaultMode: 0440
            items:
              - key: {{ required "clustertenantManager.membership.fleet.publicKeyKey is required in fleet mode" $fleetMembership.publicKeyKey | quote }}
                path: public-key.pem
        # Rotating caller identity for Fleet. Fleet must TokenReview this exact audience and bind
        # the reviewed server ServiceAccount to billingGatewayCredentialSiloId.
        - name: membership-billing-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  audience: {{ $fleetMembership.billingGatewayProjectedTokenAudience | quote }}
                  expirationSeconds: {{ $fleetMembership.billingGatewayProjectedTokenTtlSeconds }}
        {{- end }}
        # Audience-bound caller credential for the private memory gateway; rotated by the kubelet.
        # The audience must equal MEMORY_GATEWAY_PROJECTED_TOKEN_AUDIENCE in @opencrane/contracts.
        - name: memory-gateway-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  audience: opencrane-memory-gateway
                  expirationSeconds: {{ .Values.clustertenantManager.memoryGateway.projectedTokenTtlSeconds }}
        {{- if $ociRegistryAuthorization.existingSecret }}
        # OpenCrane re-reads this file for every registry request so Secret rotation takes effect.
        - name: oci-registry-authorization
          secret:
            secretName: {{ $ociRegistryAuthorization.existingSecret | quote }}
            defaultMode: 0440
            items:
              - key: {{ $ociRegistryAuthorization.secretKey | quote }}
                path: authorization
        {{- end }}
{{- end }}
