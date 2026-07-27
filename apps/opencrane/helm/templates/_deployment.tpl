{{- define "opencrane.server.deployment" -}}
{{- $managedPlane := (index .Values "managedAgentRuntimePlane").managedAgentRuntime -}}
{{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") $managedPlane.namespace -}}
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
            - name: OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID
              value: {{ required "clustertenantManager.fleetMembership.trustedIssuerId is required" .Values.clustertenantManager.fleetMembership.trustedIssuerId | quote }}
            - name: OPENCRANE_FLEET_MEMBERSHIP_KEY_ID
              value: {{ required "clustertenantManager.fleetMembership.issuerKeyId is required" .Values.clustertenantManager.fleetMembership.issuerKeyId | quote }}
            - name: OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE
              value: /var/run/opencrane/fleet-membership/public-key.pem
            - name: OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS
              value: {{ .Values.clustertenantManager.fleetMembership.maximumStalenessMs | quote }}
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
            {{- include "opencrane.clustertenantManagerDatabaseEnv" . | nindent 12 }}
            {{- /* Langfuse metrics proxy (AIR.10): wire the opencrane-ui to the in-cluster
                   Langfuse when it is deployed as a subchart. LANGFUSE_HOST points at the
                   in-cluster Service; public/secret keys come from the opencrane-langfuse
                   Secret created by k8s-deploy.sh (never appear in rendered manifests). */ -}}
            {{- if .Values.langfuse.inCluster.enabled }}
            - name: LANGFUSE_HOST
              value: "http://{{ .Release.Name }}-langfuse-web.{{ .Release.Namespace }}.svc.cluster.local:3000"
            - name: LANGFUSE_PUBLIC_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.langfuse.inCluster.existingSecret }}
                  key: LANGFUSE_INIT_PROJECT_PUBLIC_KEY
            - name: LANGFUSE_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.langfuse.inCluster.existingSecret }}
                  key: LANGFUSE_INIT_PROJECT_SECRET_KEY
            {{- end }}
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
          volumeMounts:
            - name: artifact-keys
              mountPath: /var/run/opencrane/artifact-keys
              readOnly: true
            - name: fleet-membership-key
              mountPath: /var/run/opencrane/fleet-membership
              readOnly: true
          livenessProbe:
            httpGet:
              path: /healthz
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
        - name: fleet-membership-key
          secret:
            secretName: {{ required "clustertenantManager.fleetMembership.existingSecret is required" .Values.clustertenantManager.fleetMembership.existingSecret | quote }}
            defaultMode: 0440
            items:
              - key: {{ required "clustertenantManager.fleetMembership.publicKeyKey is required" .Values.clustertenantManager.fleetMembership.publicKeyKey | quote }}
                path: public-key.pem
{{- end }}
