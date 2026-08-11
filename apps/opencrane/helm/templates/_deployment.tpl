{{- define "opencrane.server.deployment" -}}
{{- $managedPlane := (index .Values "managedAgentRuntimePlane").managedAgentRuntime -}}
{{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") $managedPlane.namespace -}}
{{- $membership := .Values.clustertenantManager.membership -}}
{{- $initialModel := .Values.clustertenantManager.initialModel -}}
{{- $firstUser := .Values.clustertenantManager.firstUser -}}
{{- $controlPlaneHost := .Values.ingress.controlPlaneHost | default (printf "platform.%s" .Values.ingress.domain) -}}
{{- $channelSiloId := .Values.channelProxy.siloId | default $firstUser.clusterTenant | default .Release.Name -}}
{{- $openCraneInternalUrl := .Values.channelProxy.openCraneInternalUrl | default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort) -}}
{{- if not (or (eq $membership.mode "standalone") (eq $membership.mode "fleet")) -}}
{{- fail "clustertenantManager.membership.mode must be standalone or fleet" -}}
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
            - name: OPENCRANE_MEMBERSHIP_MODE
              value: {{ $membership.mode | quote }}
            - name: OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS
              value: {{ $membership.maximumStalenessMs | quote }}
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
              value: {{ required "clustertenantManager.membership.fleet.trustedIssuerId is required in fleet mode" $membership.fleet.trustedIssuerId | quote }}
            - name: OPENCRANE_MEMBERSHIP_KEY_ID
              value: {{ required "clustertenantManager.membership.fleet.issuerKeyId is required in fleet mode" $membership.fleet.issuerKeyId | quote }}
            - name: OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE
              value: /var/run/opencrane/membership/public-key.pem
            {{- end }}
            # The server binds each runtime identity class to its own Helm-owned restricted namespace.
            - name: AGENT_RUNTIME_PERSONAL_NAMESPACE
              value: {{ include "opencrane.agentController.runtimeNamespace" . | quote }}
            - name: AGENT_RUNTIME_MANAGED_NAMESPACE
              value: {{ $managedRuntimeNamespace | quote }}
            # The preprocessing router TokenReviews only this Helm-owned worker namespace.
            - name: ARTIFACT_PREPROCESSOR_ENABLED
              value: {{ .Values.artifactPreprocessor.enabled | quote }}
            - name: ARTIFACT_PREPROCESSOR_NAMESPACE
              value: {{ include "opencrane.artifactPreprocessor.namespace" . | quote }}
            - name: ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES
              value: {{ .Values.artifactPreprocessor.maximumOutputBytes | quote }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "opencrane-server") | nindent 12 }}
            {{- with .Values.clustertenantManager.oidc }}
            {{- if .issuerUrl }}
            # OIDC is the only public human-authentication path. When it is absent the API
            # remains fail-closed; the chart never enables a tokenless development posture.
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
            {{- if .Values.mcpGateway.serviceTokenExistingSecret }}
            # Obot server transport: custody provisioning and durable action execution. Rendered only
            # when the pre-provisioned service-credential Secret is named; otherwise the app composes
            # fail-closed unavailable adapters and no Obot exchange can occur.
            - name: OBOT_GATEWAY_URL
              value: {{ include "opencrane.mcpGatewayUrl" . | quote }}
            - name: OBOT_SERVICE_TOKEN_PATH
              value: /var/run/opencrane/obot/token
            - name: OBOT_TIMEOUT_SECONDS
              value: {{ .Values.mcpGateway.serverTimeoutSeconds | quote }}
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
            {{- if eq $membership.mode "fleet" }}
            - name: membership-verification-key
              mountPath: /var/run/opencrane/membership
              readOnly: true
            {{- end }}
            - name: memory-gateway-token
              mountPath: /var/run/opencrane/memory-gateway
              readOnly: true
            {{- if .Values.mcpGateway.serviceTokenExistingSecret }}
            - name: obot-service-token
              mountPath: /var/run/opencrane/obot
              readOnly: true
            {{- end }}
          livenessProbe:
            # A running server can repair a transient database connection; the
            # database-backed health route remains the readiness/public gate.
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
        {{- if eq $membership.mode "fleet" }}
        - name: membership-verification-key
          secret:
            secretName: {{ required "clustertenantManager.membership.fleet.existingSecret is required in fleet mode" $membership.fleet.existingSecret | quote }}
            defaultMode: 0440
            items:
              - key: {{ required "clustertenantManager.membership.fleet.publicKeyKey is required in fleet mode" $membership.fleet.publicKeyKey | quote }}
                path: public-key.pem
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
        {{- if .Values.mcpGateway.serviceTokenExistingSecret }}
        # Pre-provisioned (out-of-band) Obot service credential; never rendered by the chart.
        - name: obot-service-token
          secret:
            secretName: {{ .Values.mcpGateway.serviceTokenExistingSecret | quote }}
            defaultMode: 0440
            items:
               - key: token
                 path: token
        {{- end }}
{{- end }}
