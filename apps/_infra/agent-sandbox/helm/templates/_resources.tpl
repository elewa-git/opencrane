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
{{- if eq (len $sandbox.profiles) 0 -}}{{- fail "agentSandbox.profiles must contain at least one profile when Agent Sandbox is enabled" -}}{{- end -}}
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
    verbs: ["create", "get"]
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
    # This policy constrains only main-resource claim specifications; status updates are excluded.
    excludeResourceRules:
      - apiGroups: ["extensions.agents.x-k8s.io"]
        apiVersions: ["v1beta1"]
        operations: ["*"]
        resources: ["sandboxclaims/status"]
        scope: Namespaced
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: {{ $sandbox.namespace | quote }}
  validations:
    - expression: request.operation == 'CREATE' && request.userInfo.username == {{ $serverUsername | toJson }}
      message: only this release's OpenCrane server may create an Agent Sandbox claim; claims are immutable
    - expression: >-
        object.metadata.namespace == {{ $sandbox.namespace | toJson }} &&
        object.metadata.name.matches('^computer-[a-z0-9]([-a-z0-9]*[a-z0-9])?-g[1-9][0-9]*$') &&
        (!has(object.metadata.generateName) || object.metadata.generateName == '') &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0) &&
        object.metadata.labels.size() == 4 &&
        object.metadata.labels.all(k, k in [
          'opencrane.ai/silo-id', 'opencrane.ai/computer-id',
          'opencrane.ai/computer-generation', 'opencrane.ai/profile']) &&
        object.metadata.labels['opencrane.ai/silo-id'].matches('^[a-z0-9]([-a-z0-9]*[a-z0-9])?$') &&
        object.metadata.labels['opencrane.ai/computer-id'].matches('^computer-[a-z0-9]([-a-z0-9]*[a-z0-9])?$') &&
        object.metadata.labels['opencrane.ai/computer-generation'].matches('^[1-9][0-9]*$') &&
        object.metadata.name == object.metadata.labels['opencrane.ai/computer-id'] + '-g' + object.metadata.labels['opencrane.ai/computer-generation'] &&
        object.metadata.labels['opencrane.ai/profile'] in {{ $profileNames | toJson }} &&
        object.metadata.annotations.size() == 1 &&
        object.metadata.annotations.all(k, k == 'opencrane.ai/lease-reason') &&
        object.metadata.annotations['opencrane.ai/lease-reason'] in ['activation_requested', 'recovery_requested']
      message: an Agent Sandbox claim must identify one bounded computer lease and contain no caller-controlled metadata
    - expression: >-
        object.spec.size() == 2 &&
        object.spec.warmPoolRef.size() == 1 &&
        object.spec.warmPoolRef.name in {{ $poolNames | toJson }} &&
        object.spec.warmPoolRef.name == {{ $profilePools | toJson }}[object.metadata.labels['opencrane.ai/profile']] &&
        object.spec.lifecycle.size() == 2 &&
        object.spec.lifecycle.shutdownPolicy == 'DeleteForeground' &&
        has(object.spec.lifecycle.shutdownTime)
      message: an Agent Sandbox claim may select only a release-owned pool and a foreground-deleted lease; it cannot inject environment variables, volumes, or pod metadata
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
        - name: agent-runtime
          image: "{{ $profile.image.repository }}@{{ $profile.image.digest }}"
          imagePullPolicy: {{ $profile.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            {{- toYaml $profile.resources | nindent 12 }}
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
  replicas: 0
  sandboxTemplateRef:
    name: {{ printf "%s-%s-template" $fullname $profile.name | trunc 63 | trimSuffix "-" }}
  updateStrategy:
    type: Recreate
{{- end }}
{{- end }}
{{- end }}
