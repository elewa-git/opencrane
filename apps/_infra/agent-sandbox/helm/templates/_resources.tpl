{{- define "opencrane.agentSandbox.resources" -}}
{{- $sandbox := .Values.agentSandbox -}}
{{- if $sandbox.enabled -}}
{{- if not (semverCompare ">=1.30.0-0" .Capabilities.KubeVersion.Version) -}}
{{- fail "agentSandbox.enabled=true requires Kubernetes 1.30+ for admissionregistration.k8s.io/v1 ValidatingAdmissionPolicy" -}}
{{- end -}}
{{- if empty $sandbox.namespace -}}{{- fail "agentSandbox.namespace is required when Agent Sandbox is enabled" -}}{{- end -}}
{{- if empty $sandbox.runtimeClassName -}}{{- fail "agentSandbox.runtimeClassName is required when Agent Sandbox is enabled" -}}{{- end -}}
{{- if empty $sandbox.serviceAccountName -}}{{- fail "agentSandbox.serviceAccountName is required when Agent Sandbox is enabled" -}}{{- end -}}
{{- if not (kindIs "slice" $sandbox.profiles) -}}{{- fail "agentSandbox.profiles must be an array" -}}{{- end -}}
{{- if ne (len $sandbox.profiles) 1 -}}{{- fail "agentSandbox.profiles must contain exactly one 0.11 profile when Agent Sandbox is enabled" -}}{{- end -}}
{{- $profileNames := list -}}
{{- $poolNames := list -}}
{{- $profilePools := dict -}}
{{- $seenProfiles := dict -}}
{{- $seenPools := dict -}}
{{- range $profile := $sandbox.profiles -}}
{{- if empty $profile.name -}}{{- fail "every Agent Sandbox profile requires a name" -}}{{- end -}}
{{- if not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $profile.name) -}}{{- fail "every Agent Sandbox profile name must be a DNS label" -}}{{- end -}}
{{- if hasKey $seenProfiles $profile.name -}}{{- fail "Agent Sandbox profile names must be unique" -}}{{- end -}}
{{- $_ := set $seenProfiles $profile.name true -}}
{{- if empty $profile.poolName -}}{{- fail "every Agent Sandbox profile requires a poolName" -}}{{- end -}}
{{- if not (or (kindIs "int64" $profile.warmReplicas) (kindIs "float64" $profile.warmReplicas)) -}}{{- fail "every Agent Sandbox profile requires numeric warmReplicas=0; computers start with an admitted lease" -}}{{- end -}}
{{- if ne (float64 $profile.warmReplicas) 0.0 -}}{{- fail "every Agent Sandbox profile requires warmReplicas=0; computers start with an admitted lease" -}}{{- end -}}
{{- if not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $profile.poolName) -}}{{- fail "every Agent Sandbox poolName must be a DNS label" -}}{{- end -}}
{{- if hasKey $seenPools $profile.poolName -}}{{- fail "Agent Sandbox pool names must be unique" -}}{{- end -}}
{{- $_ := set $seenPools $profile.poolName true -}}
{{- $_ := set $profilePools $profile.name $profile.poolName -}}
{{- if empty $profile.image.repository -}}{{- fail "every Agent Sandbox profile requires image.repository" -}}{{- end -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $profile.image.digest) -}}{{- fail "every Agent Sandbox profile requires an immutable sha256 image digest" -}}{{- end -}}
{{- if empty $profile.resources -}}{{- fail "every Agent Sandbox profile requires resources" -}}{{- end -}}
{{- $profileNames = append $profileNames $profile.name -}}
{{- $poolNames = append $poolNames $profile.poolName -}}
{{- end -}}
{{- $fullname := include "opencrane.fullname" . -}}
{{- $serverServiceAccount := printf "%s-opencrane-server" $fullname -}}
{{- $serverUsername := printf "system:serviceaccount:%s:%s" .Release.Namespace $serverServiceAccount -}}
{{- $admissionName := printf "%s-agent-sandbox-claims" $fullname | trunc 63 | trimSuffix "-" -}}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $sandbox.serviceAccountName }}
  namespace: {{ $sandbox.namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
automountServiceAccountToken: false
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $fullname }}-conversation-computer
  namespace: {{ $sandbox.namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: agent-sandbox
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace | quote }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: 8090
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace | quote }}
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
              kubernetes.io/metadata.name: {{ .Release.Namespace | quote }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: litellm
      ports:
        - protocol: TCP
          port: {{ .Values.litellm.service.port }}
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $fullname }}-agent-sandbox-claims
  namespace: {{ $sandbox.namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
rules:
  - apiGroups: ["extensions.agents.x-k8s.io"]
    resources: ["sandboxclaims"]
    verbs: ["create", "get", "patch", "delete"]
  - apiGroups: ["agents.x-k8s.io"]
    resources: ["sandboxes"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $fullname }}-agent-sandbox-claims
  namespace: {{ $sandbox.namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
subjects:
  - kind: ServiceAccount
    name: {{ $serverServiceAccount }}
    namespace: {{ .Release.Namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $fullname }}-agent-sandbox-claims
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ $admissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
spec:
  failurePolicy: Fail
  matchConstraints:
    matchPolicy: Exact
    resourceRules:
      - apiGroups: ["extensions.agents.x-k8s.io"]
        apiVersions: ["v1beta1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["sandboxclaims"]
        scope: Namespaced
    # The controller owns status; main-resource updates are limited below to metadata and lease expiry.
    excludeResourceRules:
      - apiGroups: ["extensions.agents.x-k8s.io"]
        apiVersions: ["v1beta1"]
        operations: ["*"]
        resources: ["sandboxclaims/status"]
        scope: Namespaced
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: {{ $sandbox.namespace | quote }}
  variables:
    - name: server
      expression: request.userInfo.username == {{ $serverUsername | toJson }}
    # The pinned prerequisite installs this exact identity; no namespace-wide controller exception applies.
    - name: controller
      expression: request.userInfo.username == 'system:serviceaccount:agent-sandbox-system:agent-sandbox-controller'
    - name: controllerAnnotations
      expression: >-
        ['agents.x-k8s.io/controller-first-observed-at', 'opentelemetry.io/trace-context',
         'agents.x-k8s.io/creation-latency-recorded', 'agents.x-k8s.io/sandbox-name']
    # Kubernetes removes its foreground-deletion finalizer after the dependent resources are gone.
    - name: finalizerCleanup
      expression: >-
        request.operation == 'UPDATE' &&
        request.userInfo.username == 'system:serviceaccount:kube-system:generic-garbage-collector' &&
        has(oldObject.metadata.deletionTimestamp) && has(object.metadata.deletionTimestamp) &&
        timestamp(object.metadata.deletionTimestamp) == timestamp(oldObject.metadata.deletionTimestamp) &&
        oldObject.metadata.finalizers == ['foregroundDeletion'] &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0) &&
        object.spec == oldObject.spec &&
        object.metadata.labels == oldObject.metadata.labels &&
        object.metadata.annotations == oldObject.metadata.annotations &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(oldObject.metadata.ownerReferences) || oldObject.metadata.ownerReferences.size() == 0)
  validations:
    - expression: >-
        (request.operation == 'CREATE' && variables.server) ||
        (request.operation == 'UPDATE' && !has(object.metadata.deletionTimestamp) && (variables.server || variables.controller)) ||
        variables.finalizerCleanup
      message: claim writes require the release server, pinned controller or bounded Kubernetes foreground cleanup
    - expression: >-
        object.metadata.namespace == {{ $sandbox.namespace | toJson }} &&
        object.metadata.name.matches('^computer-[a-z0-9]([-a-z0-9]*[a-z0-9])?-g[1-9][0-9]*$') &&
        (!has(object.metadata.generateName) || object.metadata.generateName == '') &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0) &&
        object.metadata.labels.size() == 5 &&
        object.metadata.labels.all(k, k in [
          'opencrane.ai/silo-id', 'opencrane.ai/computer-id',
          'opencrane.ai/computer-generation', 'opencrane.ai/computer-lease-id',
          'opencrane.ai/profile']) &&
        object.metadata.labels['opencrane.ai/silo-id'].matches('^[a-z0-9]([-a-z0-9]*[a-z0-9])?$') &&
        object.metadata.labels['opencrane.ai/computer-id'].matches('^computer-[a-z0-9]([-a-z0-9]*[a-z0-9])?$') &&
        object.metadata.labels['opencrane.ai/computer-generation'].matches('^[1-9][0-9]*$') &&
        object.metadata.labels['opencrane.ai/computer-lease-id'].matches('^[a-z0-9]([-a-z0-9]*[a-z0-9])?$') &&
        object.metadata.name == object.metadata.labels['opencrane.ai/computer-id'] + '-g' + object.metadata.labels['opencrane.ai/computer-generation'] &&
        object.metadata.labels['opencrane.ai/profile'] in {{ $profileNames | toJson }} &&
        object.metadata.annotations.all(k, k == 'opencrane.ai/lease-reason' ||
          (request.operation == 'UPDATE' && k in variables.controllerAnnotations)) &&
        object.metadata.annotations['opencrane.ai/lease-reason'] in ['activation_requested', 'recovery_requested']
      message: an Agent Sandbox claim must identify one bounded computer lease and contain no caller-controlled metadata
    - expression: >-
        !has(object.spec.env) && !has(object.spec.volumeClaimTemplates) &&
        object.spec.warmPoolRef.name in {{ $poolNames | toJson }} &&
        object.spec.warmPoolRef.name == {{ $profilePools | toJson }}[object.metadata.labels['opencrane.ai/profile']] &&
        !has(object.spec.lifecycle.ttlSecondsAfterFinished) &&
        object.spec.lifecycle.shutdownPolicy == 'DeleteForeground' &&
        has(object.spec.lifecycle.shutdownTime) &&
        object.spec.additionalPodMetadata.labels.size() == 3 &&
        object.spec.additionalPodMetadata.labels.all(k, k in [
          'opencrane.ai/computer-id', 'opencrane.ai/computer-generation',
          'opencrane.ai/computer-lease-id']) &&
        object.spec.additionalPodMetadata.labels['opencrane.ai/computer-id'] == object.metadata.labels['opencrane.ai/computer-id'] &&
        object.spec.additionalPodMetadata.labels['opencrane.ai/computer-generation'] == object.metadata.labels['opencrane.ai/computer-generation'] &&
        object.spec.additionalPodMetadata.labels['opencrane.ai/computer-lease-id'] == object.metadata.labels['opencrane.ai/computer-lease-id'] &&
        (!has(object.spec.additionalPodMetadata.annotations) || object.spec.additionalPodMetadata.annotations.size() == 0)
      message: an Agent Sandbox claim may select only a release-owned pool, a foreground-deleted lease, and the admitted computer labels copied to its Pod
    # Controller serialization may omit an empty annotation map or reformat an equivalent timestamp.
    - expression: >-
        request.operation != 'UPDATE' || variables.finalizerCleanup || (
          object.metadata.labels == oldObject.metadata.labels &&
          object.metadata.annotations['opencrane.ai/lease-reason'] == oldObject.metadata.annotations['opencrane.ai/lease-reason'] &&
          object.spec.warmPoolRef == oldObject.spec.warmPoolRef &&
          object.spec.lifecycle.shutdownPolicy == oldObject.spec.lifecycle.shutdownPolicy &&
          object.spec.additionalPodMetadata.labels == oldObject.spec.additionalPodMetadata.labels &&
          (variables.server ?
            (object.metadata.annotations == oldObject.metadata.annotations &&
             timestamp(object.spec.lifecycle.shutdownTime) > timestamp(oldObject.spec.lifecycle.shutdownTime)) :
            timestamp(object.spec.lifecycle.shutdownTime) == timestamp(oldObject.spec.lifecycle.shutdownTime))
        )
      message: claim identity and Pod inputs are immutable; the server may only extend expiry and the controller may only update its own annotations
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ $admissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
spec:
  policyName: {{ $admissionName }}
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: {{ $sandbox.namespace | quote }}
{{- range $profile := $sandbox.profiles }}
---
apiVersion: extensions.agents.x-k8s.io/v1beta1
kind: SandboxTemplate
metadata:
  name: {{ printf "%s-%s-template" $fullname $profile.name | trunc 63 | trimSuffix "-" }}
  namespace: {{ $sandbox.namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
    opencrane.ai/agent-sandbox-profile: {{ $profile.name | quote }}
spec:
  service: true
  networkPolicyManagement: Managed
  envVarsInjectionPolicy: Disallowed
  volumeClaimTemplatesPolicy: Disallowed
  podTemplate:
    metadata:
      labels:
        app.kubernetes.io/component: agent-sandbox
        opencrane.ai/agent-sandbox-profile: {{ $profile.name | quote }}
    spec:
      serviceAccountName: {{ $sandbox.serviceAccountName }}
      automountServiceAccountToken: false
      enableServiceLinks: false
      runtimeClassName: {{ $sandbox.runtimeClassName }}
      restartPolicy: Always
      terminationGracePeriodSeconds: 0
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: conversation-computer
          image: "{{ $profile.image.repository }}@{{ $profile.image.digest }}"
          imagePullPolicy: {{ $profile.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          env:
            - name: OPENCRANE_COMPUTER_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['opencrane.ai/computer-id']
            - name: OPENCRANE_COMPUTER_GENERATION
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['opencrane.ai/computer-generation']
            - name: OPENCRANE_COMPUTER_LEASE_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['opencrane.ai/computer-lease-id']
            - name: OPENCRANE_INTERNAL_ENDPOINT
              value: {{ printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" $) $.Release.Namespace $.Values.clustertenantManager.service.internalPort | quote }}
            - name: OPENCRANE_PROJECTED_TOKEN_PATH
              value: /var/run/secrets/opencrane/token
            - name: OPENCRANE_REVIEW_CREDENTIAL_PATH
              value: /var/run/opencrane/review/credential
            - name: OPENCRANE_WORKSPACE_PATH
              value: /workspace
            - name: OPENCRANE_PREVIEW_PORTS
              value: "3000,4173,4200,5173,8000"
          volumeMounts:
            - name: opencrane-conversation-computer-identity
              mountPath: /var/run/secrets/opencrane
              readOnly: true
            - name: review-credential
              mountPath: /var/run/opencrane/review
            - name: opencrane-conversation-workspace
              mountPath: /workspace
          ports:
            - name: health
              containerPort: 8080
              protocol: TCP
            - name: review
              containerPort: 8090
              protocol: TCP
          readinessProbe:
            httpGet:
              path: /readyz
              port: health
          livenessProbe:
            httpGet:
              path: /healthz
              port: health
          resources:
            {{- toYaml $profile.resources | nindent 12 }}
      volumes:
        - name: opencrane-conversation-workspace
          emptyDir:
            sizeLimit: 2Gi
        - name: review-credential
          emptyDir:
            medium: Memory
            sizeLimit: 1Mi
        - name: opencrane-conversation-computer-identity
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  audience: opencrane-conversation-computer
                  expirationSeconds: 600
---
apiVersion: extensions.agents.x-k8s.io/v1beta1
kind: SandboxWarmPool
metadata:
  name: {{ $profile.poolName }}
  namespace: {{ $sandbox.namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: agent-sandbox
    opencrane.ai/agent-sandbox-profile: {{ $profile.name | quote }}
spec:
  replicas: {{ int $profile.warmReplicas }}
  sandboxTemplateRef:
    name: {{ printf "%s-%s-template" $fullname $profile.name | trunc 63 | trimSuffix "-" }}
  updateStrategy:
    type: Recreate
{{- end }}
{{- end }}
{{- end }}
