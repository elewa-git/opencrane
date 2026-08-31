{{/*
This helper derives the personal warm-pool namespace and rejects the server namespace before
the chart renders its zero-RBAC identity and network policies.
*/}}
{{- define "opencrane.agentController.runtimeNamespace" -}}
{{- $runtimeNamespace := default (printf "%s-runtime" (include "opencrane.fullname" .) | trunc 63 | trimSuffix "-") .Values.agentController.runtimeNamespace -}}
{{- if or (gt (len $runtimeNamespace) 63) (not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $runtimeNamespace)) -}}
{{- fail "agentController.runtimeNamespace must be a valid DNS-label namespace of at most 63 characters" -}}
{{- end -}}
{{- if eq $runtimeNamespace .Release.Namespace -}}
{{- fail "agentController.runtimeNamespace must differ from the server release namespace" -}}
{{- end -}}
{{- $runtimeNamespace -}}
{{- end }}

{{/*
This helper derives the managed warm-pool namespace once for the controller, server, and policies.
It rejects either release-owned namespace because sharing one would collapse their trust boundaries.
*/}}
{{- define "opencrane.agentController.managedRuntimeNamespace" -}}
{{- $runtimeNamespace := include "opencrane.agentController.runtimeNamespace" . -}}
{{- $managedRuntimeNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") .Values.agentController.warmRuntime.managedNamespace -}}
{{- if or (gt (len $managedRuntimeNamespace) 63) (not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $managedRuntimeNamespace)) (eq $managedRuntimeNamespace .Release.Namespace) (eq $managedRuntimeNamespace $runtimeNamespace) -}}
{{- fail "agentController.warmRuntime.managedNamespace must be a valid namespace distinct from the server and personal runtime namespaces" -}}
{{- end -}}
{{- $managedRuntimeNamespace -}}
{{- end }}

{{/* Release-unique label value used by NetworkPolicy and admission scoping without trusting a name alone. */}}
{{- define "opencrane.agentController.runtimeNamespaceLabelValue" -}}
{{- printf "%s/%s/%s" .Release.Namespace .Release.Name (include "opencrane.agentController.runtimeNamespace" .) | sha256sum | trunc 32 -}}
{{- end }}

{{/* Cluster-scoped admission name remains unique when equal release names exist in different silos. */}}
{{- define "opencrane.agentController.admissionName" -}}
{{- $suffix := printf "%s/%s" .Release.Namespace .Release.Name | sha256sum | trunc 10 -}}
{{- printf "%s-runtime-%s" (include "opencrane.fullname" .) $suffix | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "opencrane.agentController.resources" -}}
{{- if .Values.agentController.enabled }}
{{- if not (semverCompare ">=1.30.0-0" .Capabilities.KubeVersion.Version) }}
{{- fail "agentController.enabled=true requires Kubernetes 1.30+ for admissionregistration.k8s.io/v1 ValidatingAdmissionPolicy" }}
{{- end }}
{{- if eq (include "opencrane.litellmShared" .) "true" }}
{{- fail "agentController.enabled=true requires sharedPlatform.litellm.mode=instance for its same-silo runtime boundary" }}
{{- end }}
{{- if not .Values.agentController.kubernetesApiServerCidrs }}
{{- fail "agentController.enabled=true requires at least one exact agentController.kubernetesApiServerCidrs entry for bounded Kubernetes API egress" }}
{{- end }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.agentController.image.digest) }}
{{- fail "agentController.enabled=true requires an immutable sha256 agentController.image.digest" }}
{{- end }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.agentController.runtimeProfile.image.digest) }}
{{- fail "agentController.enabled=true requires an immutable sha256 agentController.runtimeProfile.image.digest" }}
{{- end }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.agentController.skillAuthoringValidation.image.digest) }}
{{- fail "agentController.enabled=true requires an immutable sha256 authoring worker image digest" }}
{{- end }}
{{- $mcpExecutorValues := (index .Values "opencrane-mcp-executor").mcpExecutor -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $mcpExecutorValues.image.digest) }}
{{- fail "agentController.enabled=true requires an immutable sha256 MCP companion image digest" }}
{{- end }}
{{- $database := .Values.clustertenantManager.database -}}
{{- if and (empty $database.existingSecret) (empty $database.url) }}
{{- fail "agentController.enabled=true requires clustertenantManager.database.existingSecret or url for durable workflow workers" }}
{{- end }}
{{- $controllerName := "agent-controller" -}}
{{- $runtimeNamespace := include "opencrane.agentController.runtimeNamespace" . -}}
{{- $runtimeNamespaceLabel := include "opencrane.agentController.runtimeNamespaceLabelValue" . -}}
{{- $managedRuntimeNamespace := include "opencrane.agentController.managedRuntimeNamespace" . -}}
{{- $openCraneInternalUrl := default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort) .Values.agentController.openCraneInternalUrl -}}
{{- $skillBootstrapUrl := printf "http://%s-opencrane-server.%s.svc.cluster.local:%v/api/internal/agent-runtime" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort -}}
{{- $runtimeImage := printf "%s@%s" .Values.agentController.runtimeProfile.image.repository .Values.agentController.runtimeProfile.image.digest -}}
{{- $personalRuntimeProfileName := .Values.agentController.runtimeProfile.name -}}
{{- $managedRuntimeProfileName := "managed-default" -}}
{{- if or (gt (len $personalRuntimeProfileName) 63) (not (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $personalRuntimeProfileName)) (eq $personalRuntimeProfileName $managedRuntimeProfileName) -}}
{{- fail "agentController.runtimeProfile.name must be a valid personal profile name distinct from reserved managed-default" -}}
{{- end -}}
{{- $runtimeNamespaces := list $runtimeNamespace $managedRuntimeNamespace -}}
{{- $authoringImage := printf "%s@%s" .Values.agentController.skillAuthoringValidation.image.repository .Values.agentController.skillAuthoringValidation.image.digest -}}
{{- $authoringNamespace := (index .Values "opencrane-skill-authoring").skillAuthoring.namespace -}}
{{- $mcpExecutorNamespace := $mcpExecutorValues.namespace -}}
{{- $artifactValues := .Values.artifactPreprocessor -}}
{{- $artifactNamespace := include "opencrane.artifactPreprocessor.namespace" . -}}
{{- if or (eq $authoringNamespace .Release.Namespace) (eq $mcpExecutorNamespace .Release.Namespace) (and $artifactValues.enabled (eq $artifactNamespace .Release.Namespace)) (eq $authoringNamespace $mcpExecutorNamespace) (and $artifactValues.enabled (or (eq $artifactNamespace $authoringNamespace) (eq $artifactNamespace $mcpExecutorNamespace))) }}
{{- fail "governed workload namespaces must be distinct from the server and from each other" }}
{{- end }}
{{- $mcpCompanionImage := printf "%s@%s" $mcpExecutorValues.image.repository $mcpExecutorValues.image.digest -}}
{{- $mcpInternalUrl := printf "http://%s-opencrane-server.%s.svc.cluster.local:%v/api/internal/mcp-executor" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort -}}
{{- $serverServiceName := printf "%s-opencrane-server" (include "opencrane.fullname" .) -}}
{{- $artifactImage := printf "%s@%s" $artifactValues.image.repository $artifactValues.image.digest -}}
{{- $artifactInternalUrl := printf "http://%s.%s.svc.cluster.local:%v" $serverServiceName .Release.Namespace .Values.clustertenantManager.service.internalPort -}}
{{- $siloId := .Values.channelProxy.siloId | default .Values.clustertenantManager.firstUser.clusterTenant | default .Release.Name -}}
{{- $controllerImage := printf "%s@%s" .Values.agentController.image.repository .Values.agentController.image.digest -}}
{{- $controllerUsername := printf "system:serviceaccount:%s:%s" .Release.Namespace $controllerName -}}
{{- $skillAdmissionName := printf "%s-skill-authoring" (include "opencrane.agentController.admissionName" .) -}}
{{- $mcpAdmissionName := printf "%s-mcp-executor" (include "opencrane.agentController.admissionName" .) | trunc 63 | trimSuffix "-" -}}
{{- $artifactAdmissionName := printf "%s-artifact-preprocessor" (include "opencrane.agentController.admissionName" .) | trunc 63 | trimSuffix "-" -}}
{{- range $namespace := $runtimeNamespaces }}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ $namespace }}
  labels:
    opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
---
{{- end }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $controllerName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: agent-controller
automountServiceAccountToken: false
---
{{- range $namespace := $runtimeNamespaces }}
# Keep each fixed warm pool inside its deployment, Pod, CPU, and memory budget.
apiVersion: v1
kind: ResourceQuota
metadata:
  name: {{ include "opencrane.fullname" $ }}-warm-runtime
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: warm-runtime
spec:
  hard:
    pods: {{ $.Values.agentController.runtimeQuota.pods | quote }}
    count/deployments.apps: {{ $.Values.agentController.runtimeQuota.deployments | quote }}
    requests.cpu: {{ $.Values.agentController.runtimeQuota.requests.cpu | quote }}
    requests.memory: {{ $.Values.agentController.runtimeQuota.requests.memory | quote }}
    limits.cpu: {{ $.Values.agentController.runtimeQuota.limits.cpu | quote }}
    limits.memory: {{ $.Values.agentController.runtimeQuota.limits.memory | quote }}
---
{{- end }}
{{- range $namespace := (list $authoringNamespace) }}
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $controllerName }}-skill-authoring
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: agent-controller
rules:
  # A governed skill Job is created suspended, then released by one UID/resourceVersion-fenced patch.
  # The admission policy below permits only that immutable-template-preserving transition.
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "create", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $controllerName }}-skill-authoring
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: agent-controller
subjects:
  - kind: ServiceAccount
    name: {{ $controllerName }}
    namespace: {{ $.Release.Namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $controllerName }}-skill-authoring
---
{{- end }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $controllerName }}-mcp-executor
  namespace: {{ $mcpExecutorNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "create", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $controllerName }}-mcp-executor
  namespace: {{ $mcpExecutorNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
subjects:
  - kind: ServiceAccount
    name: {{ $controllerName }}
    namespace: {{ .Release.Namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $controllerName }}-mcp-executor
---
{{- if $artifactValues.enabled }}
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $controllerName }}-artifact-preprocessor
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $controllerName }}-artifact-preprocessor
  namespace: {{ $artifactNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
subjects:
  - kind: ServiceAccount
    name: {{ $controllerName }}
    namespace: {{ .Release.Namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $controllerName }}-artifact-preprocessor
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ $artifactAdmissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-preprocessor
spec:
  failurePolicy: Fail
  matchConstraints:
    matchPolicy: Exact
    resourceRules:
      - apiGroups: ["batch"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["jobs"]
        scope: "Namespaced"
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: {{ $artifactNamespace | quote }}
  validations:
    - expression: request.userInfo.username == {{ $controllerUsername | toJson }}
      message: only this release's controller ServiceAccount may create or release artifact preprocessing Jobs
    - expression: >-
        object.metadata.namespace == {{ $artifactNamespace | toJson }} &&
        object.metadata.name.matches('^artifact-preprocess-[a-f0-9]{24}$') &&
        object.metadata.labels.size() >= 2 && object.metadata.labels.size() <= 6 &&
        object.metadata.labels.all(k, k in [
          'app.kubernetes.io/component', 'opencrane.ai/artifact-preprocessor',
          'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name',
          'controller-uid', 'job-name']) &&
        object.metadata.labels['app.kubernetes.io/component'] == 'artifact-preprocessor' &&
        object.metadata.labels['opencrane.ai/artifact-preprocessor'] == object.metadata.name &&
        (!('batch.kubernetes.io/job-name' in object.metadata.labels) || object.metadata.labels['batch.kubernetes.io/job-name'] == object.metadata.name) &&
        (!('job-name' in object.metadata.labels) || object.metadata.labels['job-name'] == object.metadata.name) &&
        (!has(object.metadata.uid) || !('batch.kubernetes.io/controller-uid' in object.metadata.labels) || object.metadata.labels['batch.kubernetes.io/controller-uid'] == string(object.metadata.uid)) &&
        (!has(object.metadata.uid) || !('controller-uid' in object.metadata.labels) || object.metadata.labels['controller-uid'] == string(object.metadata.uid)) &&
        object.metadata.annotations.size() == 1 &&
        object.metadata.annotations['opencrane.ai/bootstrap-reference'].matches('^artifact-preprocess-bootstrap-v1_[a-f0-9]{64}$') &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0) &&
        (!has(object.metadata.generateName) || object.metadata.generateName == '')
      message: artifact preprocessing Job identity must match one opaque saved assignment
    - expression: >-
        object.spec.parallelism == 1 && object.spec.completions == 1 && object.spec.backoffLimit == 0 &&
        object.spec.activeDeadlineSeconds > 0 &&
        object.spec.activeDeadlineSeconds <= {{ $artifactValues.activeDeadlineSeconds }} &&
        (!has(object.spec.manualSelector) || object.spec.manualSelector == false) &&
        (!has(object.spec.completionMode) || object.spec.completionMode == 'NonIndexed') &&
        !has(object.spec.podFailurePolicy) && !has(object.spec.successPolicy) &&
        (!has(object.spec.backoffLimitPerIndex) || object.spec.backoffLimitPerIndex == 0) &&
        (!has(object.spec.maxFailedIndexes) || object.spec.maxFailedIndexes == 0)
      message: artifact preprocessing Job lifecycle must stay one-shot and bounded
    - expression: >-
        !has(object.spec.selector) ||
        ((!has(object.spec.selector.matchExpressions) || object.spec.selector.matchExpressions.size() == 0) &&
          has(object.spec.selector.matchLabels) && object.spec.selector.matchLabels.size() > 0 &&
          object.spec.selector.matchLabels.size() <= 4 &&
          object.spec.selector.matchLabels.all(k, k in [
            'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name',
            'controller-uid', 'job-name']) &&
          (!('batch.kubernetes.io/job-name' in object.spec.selector.matchLabels) || object.spec.selector.matchLabels['batch.kubernetes.io/job-name'] == object.metadata.name) &&
          (!('job-name' in object.spec.selector.matchLabels) || object.spec.selector.matchLabels['job-name'] == object.metadata.name) &&
          (!has(object.metadata.uid) || !('batch.kubernetes.io/controller-uid' in object.spec.selector.matchLabels) || object.spec.selector.matchLabels['batch.kubernetes.io/controller-uid'] == string(object.metadata.uid)) &&
          (!has(object.metadata.uid) || !('controller-uid' in object.spec.selector.matchLabels) || object.spec.selector.matchLabels['controller-uid'] == string(object.metadata.uid)))
      message: only Kubernetes-owned selector labels may be defaulted for artifact preprocessing Jobs
    - expression: >-
        object.spec.template.metadata.labels.size() >= 2 && object.spec.template.metadata.labels.size() <= 6 &&
        object.spec.template.metadata.labels.all(k, k in [
          'app.kubernetes.io/component', 'opencrane.ai/artifact-preprocessor',
          'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name',
          'controller-uid', 'job-name']) &&
        object.spec.template.metadata.labels['app.kubernetes.io/component'] == 'artifact-preprocessor' &&
        object.spec.template.metadata.labels['opencrane.ai/artifact-preprocessor'] == object.metadata.name &&
        (!('batch.kubernetes.io/job-name' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['batch.kubernetes.io/job-name'] == object.metadata.name) &&
        (!('job-name' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['job-name'] == object.metadata.name) &&
        (!has(object.metadata.uid) || !('batch.kubernetes.io/controller-uid' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['batch.kubernetes.io/controller-uid'] == string(object.metadata.uid)) &&
        (!has(object.metadata.uid) || !('controller-uid' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['controller-uid'] == string(object.metadata.uid)) &&
        object.spec.template.metadata.annotations.size() == 1 &&
        object.spec.template.metadata.annotations['opencrane.ai/bootstrap-reference'] == object.metadata.annotations['opencrane.ai/bootstrap-reference'] &&
        (!has(object.spec.template.metadata.name) || object.spec.template.metadata.name == '') &&
        (!has(object.spec.template.metadata.generateName) || object.spec.template.metadata.generateName == '') &&
        (!has(object.spec.template.metadata.namespace) || object.spec.template.metadata.namespace == '') &&
        (!has(object.spec.template.metadata.ownerReferences) || object.spec.template.metadata.ownerReferences.size() == 0) &&
        (!has(object.spec.template.metadata.finalizers) || object.spec.template.metadata.finalizers.size() == 0)
      message: artifact preprocessing Pod identity must match the saved Job assignment
    - expression: >-
        object.spec.template.spec.serviceAccountName == 'artifact-preprocessor' &&
        (!has(object.spec.template.spec.serviceAccount) || object.spec.template.spec.serviceAccount == 'artifact-preprocessor') &&
        object.spec.template.spec.automountServiceAccountToken == false &&
        object.spec.template.spec.enableServiceLinks == false &&
        object.spec.template.spec.restartPolicy == 'Never' &&
        object.spec.template.spec.securityContext.runAsNonRoot == true &&
        object.spec.template.spec.securityContext.runAsUser == 65532 &&
        object.spec.template.spec.securityContext.runAsGroup == 65532 &&
        object.spec.template.spec.securityContext.fsGroup == 65532 &&
        object.spec.template.spec.securityContext.seccompProfile.type == 'RuntimeDefault' &&
        (!has(object.spec.template.spec.hostNetwork) || object.spec.template.spec.hostNetwork == false) &&
        (!has(object.spec.template.spec.hostPID) || object.spec.template.spec.hostPID == false) &&
        (!has(object.spec.template.spec.hostIPC) || object.spec.template.spec.hostIPC == false) &&
        (!has(object.spec.template.spec.shareProcessNamespace) || object.spec.template.spec.shareProcessNamespace == false) &&
        (!has(object.spec.template.spec.nodeName) || object.spec.template.spec.nodeName == '') &&
        (!has(object.spec.template.spec.nodeSelector) || object.spec.template.spec.nodeSelector.size() == 0) &&
        !has(object.spec.template.spec.affinity) &&
        (!has(object.spec.template.spec.tolerations) || object.spec.template.spec.tolerations.size() == 0) &&
        !has(object.spec.template.spec.hostAliases) &&
        (!has(object.spec.template.spec.imagePullSecrets) || object.spec.template.spec.imagePullSecrets.size() == 0) &&
        !has(object.spec.template.spec.runtimeClassName) && !has(object.spec.template.spec.priorityClassName) &&
        (!has(object.spec.template.spec.schedulerName) || object.spec.template.spec.schedulerName == 'default-scheduler') &&
        object.spec.template.spec.terminationGracePeriodSeconds == 0 &&
        (!has(object.spec.template.spec.dnsPolicy) || object.spec.template.spec.dnsPolicy == 'ClusterFirst') &&
        !has(object.spec.template.spec.dnsConfig)
      message: artifact preprocessing Pod identity and host isolation must match the fixed profile
    - expression: >-
        object.spec.template.spec.containers.size() == 1 &&
        (!has(object.spec.template.spec.initContainers) || object.spec.template.spec.initContainers.size() == 0) &&
        (!has(object.spec.template.spec.ephemeralContainers) || object.spec.template.spec.ephemeralContainers.size() == 0) &&
        object.spec.template.spec.containers[0].name == 'artifact-preprocessor' &&
        object.spec.template.spec.containers[0].image == {{ $artifactImage | toJson }} &&
        object.spec.template.spec.containers[0].imagePullPolicy == {{ $artifactValues.image.pullPolicy | toJson }} &&
        object.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation == false &&
        object.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem == true &&
        object.spec.template.spec.containers[0].securityContext.capabilities.drop == ['ALL'] &&
        (!has(object.spec.template.spec.containers[0].securityContext.capabilities.add) || object.spec.template.spec.containers[0].securityContext.capabilities.add.size() == 0) &&
        (!has(object.spec.template.spec.containers[0].command) || object.spec.template.spec.containers[0].command.size() == 0) &&
        (!has(object.spec.template.spec.containers[0].args) || object.spec.template.spec.containers[0].args.size() == 0) &&
        !has(object.spec.template.spec.containers[0].lifecycle) &&
        !has(object.spec.template.spec.containers[0].livenessProbe) &&
        !has(object.spec.template.spec.containers[0].readinessProbe) &&
        !has(object.spec.template.spec.containers[0].startupProbe) &&
        !has(object.spec.template.spec.containers[0].envFrom) &&
        (!has(object.spec.template.spec.containers[0].ports) || object.spec.template.spec.containers[0].ports.size() == 0) &&
        object.spec.template.spec.containers[0].resources.requests.size() == 2 &&
        object.spec.template.spec.containers[0].resources.limits.size() == 2 &&
        quantity(object.spec.template.spec.containers[0].resources.requests.cpu).compareTo(quantity({{ $artifactValues.resources.requests.cpu | toString | toJson }})) == 0 &&
        quantity(object.spec.template.spec.containers[0].resources.requests.memory).compareTo(quantity({{ $artifactValues.resources.requests.memory | toString | toJson }})) == 0 &&
        quantity(object.spec.template.spec.containers[0].resources.limits.cpu).compareTo(quantity({{ $artifactValues.resources.limits.cpu | toString | toJson }})) == 0 &&
        quantity(object.spec.template.spec.containers[0].resources.limits.memory).compareTo(quantity({{ $artifactValues.resources.limits.memory | toString | toJson }})) == 0
      message: artifact preprocessing image, container shape, security and resources are immutable
    - expression: >-
        object.spec.template.spec.containers[0].env.size() == 4 &&
        object.spec.template.spec.containers[0].env[0].name == 'OPENCRANE_INTERNAL_URL' &&
        object.spec.template.spec.containers[0].env[0].value == {{ $artifactInternalUrl | toJson }} &&
        object.spec.template.spec.containers[0].env[1].name == 'OPENCRANE_PREPROCESSOR_TOKEN_PATH' &&
        object.spec.template.spec.containers[0].env[1].value == '/var/run/opencrane/tokens/opencrane.token' &&
        object.spec.template.spec.containers[0].env[2].name == 'OPENCRANE_PREPROCESSOR_BOOTSTRAP_REFERENCE_PATH' &&
        object.spec.template.spec.containers[0].env[2].value == '/var/run/opencrane/bootstrap/reference' &&
        object.spec.template.spec.containers[0].env[3].name == 'ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY' &&
        object.spec.template.spec.containers[0].env[3].value == '/scratch' &&
        object.spec.template.spec.containers[0].volumeMounts.size() == 3 &&
        object.spec.template.spec.containers[0].volumeMounts[0].name == 'opencrane-token' &&
        object.spec.template.spec.containers[0].volumeMounts[0].mountPath == '/var/run/opencrane/tokens' &&
        object.spec.template.spec.containers[0].volumeMounts[0].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[1].name == 'bootstrap-reference' &&
        object.spec.template.spec.containers[0].volumeMounts[1].mountPath == '/var/run/opencrane/bootstrap' &&
        object.spec.template.spec.containers[0].volumeMounts[1].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[2].name == 'scratch' &&
        object.spec.template.spec.containers[0].volumeMounts[2].mountPath == '/scratch'
      message: artifact preprocessing environment and mounts must contain only the fixed broker interfaces
    - expression: >-
        object.spec.template.spec.volumes.size() == 3 &&
        object.spec.template.spec.volumes[0].name == 'opencrane-token' &&
        object.spec.template.spec.volumes[0].projected.defaultMode == 288 &&
        object.spec.template.spec.volumes[0].projected.sources.size() == 1 &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.path == 'opencrane.token' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-artifact-preprocessor' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.expirationSeconds == 600 &&
        object.spec.template.spec.volumes[1].name == 'bootstrap-reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.defaultMode == 288 &&
        object.spec.template.spec.volumes[1].downwardAPI.items.size() == 1 &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].path == 'reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].fieldRef.fieldPath == "metadata.annotations['opencrane.ai/bootstrap-reference']" &&
        object.spec.template.spec.volumes[2].name == 'scratch' &&
        (!has(object.spec.template.spec.volumes[2].emptyDir.medium) || object.spec.template.spec.volumes[2].emptyDir.medium == '') &&
        quantity(object.spec.template.spec.volumes[2].emptyDir.sizeLimit).compareTo(quantity({{ $artifactValues.scratchSize | toJson }})) == 0
      message: artifact preprocessing volumes must be exactly one audience token, one reference, and bounded scratch
    - expression: >-
        (request.operation == 'CREATE' && object.spec.suspend == true) ||
        (request.operation == 'UPDATE' && oldObject.spec.suspend == true && object.spec.suspend == false &&
          object.metadata.name == oldObject.metadata.name &&
          object.metadata.labels == oldObject.metadata.labels &&
          object.metadata.annotations == oldObject.metadata.annotations &&
          object.spec.parallelism == oldObject.spec.parallelism &&
          object.spec.completions == oldObject.spec.completions &&
          object.spec.backoffLimit == oldObject.spec.backoffLimit &&
          object.spec.activeDeadlineSeconds > 0 &&
          object.spec.activeDeadlineSeconds <= oldObject.spec.activeDeadlineSeconds &&
          object.spec.template == oldObject.spec.template)
      message: artifact preprocessing create must be suspended and update may only release the exact stored Job once
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ $artifactAdmissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: artifact-preprocessor
spec:
  policyName: {{ $artifactAdmissionName }}
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: {{ $artifactNamespace | quote }}
---
{{- end }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-agent-controller
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
spec:
  replicas: {{ .Values.agentController.replicas }}
  minReadySeconds: 10
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: agent-controller
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: agent-controller
    spec:
      serviceAccountName: {{ $controllerName }}
      automountServiceAccountToken: false
      enableServiceLinks: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: agent-controller
          image: {{ $controllerImage | quote }}
          imagePullPolicy: {{ .Values.agentController.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true
          env:
            {{- include "opencrane.clustertenantManagerDatabaseEnv" . | nindent 12 }}
            - name: OPENCRANE_SILO_ID
              value: {{ $siloId | quote }}
            - name: OPENCRANE_INTERNAL_URL
              value: {{ $openCraneInternalUrl | quote }}
            - name: OPENCRANE_SERVER_SERVICE_NAME
              value: {{ $serverServiceName | quote }}
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: OPENCRANE_CONTROLLER_TOKEN_PATH
              value: /var/run/opencrane/tokens/opencrane.token
            - name: OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE
              value: {{ .Values.clustertenantManager.workflows.databasePoolSize | quote }}
            - name: OPENCRANE_WORKFLOW_WORKER_CONCURRENCY
              value: {{ .Values.clustertenantManager.workflows.workerConcurrency | quote }}
            - name: OPENCRANE_WORKFLOW_POLL_INTERVAL_MS
              value: {{ .Values.clustertenantManager.workflows.pollIntervalMilliseconds | quote }}
            - name: AGENT_CONTROLLER_POLL_INTERVAL_MS
              value: {{ .Values.agentController.pollIntervalMs | quote }}
            {{- $warm := .Values.agentController.warmRuntime }}
            {{- $personalWarmProfile := dict "namespace" $runtimeNamespace "deploymentName" (printf "%s-personal-warm" (include "opencrane.fullname" .)) "serviceAccountName" $warm.serviceAccountName "genericProfile" $warm.genericProfile "claimedProfile" $warm.personalProfile "image" $runtimeImage "imagePullPolicy" .Values.agentController.runtimeProfile.image.pullPolicy "bindingPort" $warm.bindingPort "genericIdleSeconds" $warm.genericIdleSeconds "scratchSize" .Values.agentController.runtimeProfile.scratchSize "resources" .Values.agentController.runtimeProfile.resources }}
            {{- $managedWarmProfile := dict "namespace" $managedRuntimeNamespace "deploymentName" (printf "%s-managed-warm" (include "opencrane.fullname" .)) "serviceAccountName" $warm.serviceAccountName "genericProfile" $warm.genericProfile "claimedProfile" $warm.managedProfile "image" $runtimeImage "imagePullPolicy" .Values.agentController.runtimeProfile.image.pullPolicy "bindingPort" $warm.bindingPort "genericIdleSeconds" $warm.genericIdleSeconds "scratchSize" .Values.agentController.runtimeProfile.scratchSize "resources" .Values.agentController.runtimeProfile.resources }}
            - name: AGENT_CONTROLLER_WARM_PROFILES_JSON
              value: {{ dict .Values.agentController.runtimeProfile.name $personalWarmProfile $managedRuntimeProfileName $managedWarmProfile | toJson | quote }}
            - name: AGENT_CONTROLLER_SKILL_AUTHORING_PROFILE_JSON
              value: {{ dict "image" $authoringImage "imagePullPolicy" .Values.agentController.skillAuthoringValidation.image.pullPolicy "serverNamespace" .Release.Namespace "namespace" $authoringNamespace "serviceAccountName" "skill-authoring-default" "capabilityTokenAudience" "opencrane-skill-authoring" "bootstrapUrl" $skillBootstrapUrl "capabilityTokenPath" "/var/run/opencrane/tokens/capability.token" "bootstrapReferencePath" "/var/run/opencrane/bootstrap/reference" "scratchSize" .Values.agentController.skillAuthoringValidation.scratchSize "activeDeadlineSeconds" .Values.agentController.skillAuthoringValidation.activeDeadlineSeconds "ttlSecondsAfterFinished" 0 "resources" .Values.agentController.skillAuthoringValidation.resources | toJson | quote }}
            - name: AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON
              value: {{ dict "companionImage" $mcpCompanionImage "imagePullPolicy" $mcpExecutorValues.image.pullPolicy "serverNamespace" .Release.Namespace "namespace" $mcpExecutorNamespace "serviceAccountName" $mcpExecutorValues.serviceAccountName "opencraneInternalUrl" $mcpInternalUrl "projectedTokenTtlSeconds" $mcpExecutorValues.projectedTokenTtlSeconds "scratchSize" $mcpExecutorValues.scratchSize "activeDeadlineSeconds" $mcpExecutorValues.activeDeadlineSeconds "serverResources" $mcpExecutorValues.serverResources "companionResources" $mcpExecutorValues.companionResources | toJson | quote }}
            {{- if $artifactValues.enabled }}
            - name: AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON
              value: {{ dict "image" $artifactImage "imagePullPolicy" $artifactValues.image.pullPolicy "serverNamespace" .Release.Namespace "serverServiceName" $serverServiceName "namespace" $artifactNamespace "serviceAccountName" "artifact-preprocessor" "tokenAudience" "opencrane-artifact-preprocessor" "openCraneInternalUrl" $artifactInternalUrl "tokenPath" "/var/run/opencrane/tokens/opencrane.token" "bootstrapReferencePath" "/var/run/opencrane/bootstrap/reference" "scratchSize" $artifactValues.scratchSize "activeDeadlineSeconds" $artifactValues.activeDeadlineSeconds "resources" $artifactValues.resources | toJson | quote }}
            {{- end }}
            {{- include "opencrane.observabilityEnv" (dict "ctx" $ "component" "agent-controller") | nindent 12 }}
          volumeMounts:
            - name: opencrane-token
              mountPath: /var/run/opencrane/tokens
              readOnly: true
            - name: kubernetes-api-access
              mountPath: /var/run/secrets/kubernetes.io/serviceaccount
              readOnly: true
            - name: tmp
              mountPath: /tmp
          resources:
            {{- toYaml .Values.agentController.resources | nindent 12 }}
      volumes:
        - name: opencrane-token
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: opencrane.token
                  audience: opencrane-agent-controller
                  expirationSeconds: {{ .Values.agentController.projectedTokenTtlSeconds }}
        - name: kubernetes-api-access
          projected:
            defaultMode: 0440
            sources:
              - serviceAccountToken:
                  path: token
                  expirationSeconds: {{ .Values.agentController.kubernetesTokenTtlSeconds }}
              - configMap:
                  name: kube-root-ca.crt
                  items:
                    - key: ca.crt
                      path: ca.crt
              - downwardAPI:
                  items:
                    - path: namespace
                      fieldRef:
                        fieldPath: metadata.namespace
        - name: tmp
          emptyDir:
            sizeLimit: 64Mi
---
# The controller remains in the server namespace. Egress names both namespaces explicitly so a
# same-label pod in another release cannot become an internal-API destination.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-agent-controller
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: agent-controller
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.service.internalPort }}
    # Readiness can reach only a Pod whose release-owned pool has already entered its fixed claimed
    # profile. The destination policy independently admits this controller on the binding port.
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $runtimeNamespace }}
              opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: warm-runtime
              opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" . }}-personal-warm
              opencrane.ai/warm-runtime-profile: {{ .Values.agentController.warmRuntime.personalProfile }}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $managedRuntimeNamespace }}
              opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: warm-runtime
              opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" . }}-managed-warm
              opencrane.ai/warm-runtime-profile: {{ .Values.agentController.warmRuntime.managedProfile }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.warmRuntime.bindingPort }}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Release.Namespace }}
          podSelector:
            matchLabels:
              cnpg.io/poolerName: {{ include "opencrane.postgresPoolerName" . }}
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    {{- if .Values.networkPolicy.dnsResolverCidrs }}
    - to:
        {{- range .Values.networkPolicy.dnsResolverCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    {{- end }}
    - to:
        {{- range .Values.agentController.kubernetesApiServerCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.kubernetesApiServerPort }}
    {{- if .Values.agentController.kubernetesApiServerEndpointCidrs }}
    # Some CNIs enforce egress after Service destination translation. Admit the exact
    # discovered API endpoint as well as the stable Service IP above.
    - to:
        {{- range .Values.agentController.kubernetesApiServerEndpointCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.kubernetesApiServerEndpointPort }}
    {{- end }}
    {{- if .Values.observability.otel.enabled }}
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: otel-collector
      ports:
        - protocol: TCP
          port: {{ .Values.observability.otel.collector.otlpPort }}
    {{- end }}
---
# Add claimed warm Pods to LiteLLM's app-owned ingress boundary. The base policy separately admits
# its release-local server and Cognee callers; this rule owns only the runtime path.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-warm-runtime-litellm
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: litellm
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: litellm
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $runtimeNamespace }}
              opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: warm-runtime
              opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" . }}-personal-warm
              opencrane.ai/warm-runtime-profile: {{ .Values.agentController.warmRuntime.personalProfile }}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $managedRuntimeNamespace }}
              opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
          podSelector:
            matchLabels:
              app.kubernetes.io/component: warm-runtime
              opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" . }}-managed-warm
              opencrane.ai/warm-runtime-profile: {{ .Values.agentController.warmRuntime.managedProfile }}
      ports:
        - protocol: TCP
          port: {{ .Values.litellm.service.port }}
---
{{- range $namespace := $runtimeNamespaces }}
# Deny runtime traffic unless the Pod's generic or claimed profile admits a named path.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" $ }}-warm-runtime-default-deny
  namespace: {{ $namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: warm-runtime
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress: []
---
{{- end }}
# The MCP controller may create only the fixed two-container envelope. The uploaded image is the
# sole dynamic field and must remain an immutable registry digest; it receives no projected token.
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ $mcpAdmissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: mcp-executor
spec:
  failurePolicy: Fail
  matchConstraints:
    matchPolicy: Exact
    resourceRules:
      - apiGroups: ["batch"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["jobs"]
        scope: "Namespaced"
    namespaceSelector:
      matchLabels:
        app.kubernetes.io/component: mcp-executor
  validations:
    - expression: request.userInfo.username == {{ $controllerUsername | toJson }}
      message: only this release's controller ServiceAccount may create MCP executor Jobs
    - expression: >-
        object.metadata.namespace == {{ $mcpExecutorNamespace | toJson }} &&
        object.metadata.name.matches('^mcp-exec-[a-f0-9]{24}$') &&
        object.metadata.labels.size() == 3 &&
        object.metadata.labels['app.kubernetes.io/name'] == 'opencrane-mcp-executor' &&
        object.metadata.labels['app.kubernetes.io/component'] == 'mcp-executor' &&
        object.metadata.labels['opencrane.ai/mcp-workload'] == object.metadata.name &&
        object.metadata.annotations.size() == 5 &&
        object.metadata.annotations['opencrane.ai/mcp-claim-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/silo-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/mcp-delivery-count'].matches('^[1-9][0-9]*$') &&
        object.metadata.annotations['opencrane.ai/mcp-profile'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/mcp-execution-reference'].size() > 0 &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0)
      message: MCP executor Job identity must match one saved claim
    - expression: >-
        (request.operation == 'UPDATE' || object.spec.suspend == true) &&
        object.spec.parallelism == 1 && object.spec.completions == 1 && object.spec.backoffLimit == 0 &&
        object.spec.ttlSecondsAfterFinished == 0 && object.spec.activeDeadlineSeconds > 0 &&
        object.spec.activeDeadlineSeconds <= {{ $mcpExecutorValues.activeDeadlineSeconds }} &&
        object.spec.template.spec.serviceAccountName == 'mcp-executor-default' &&
        object.spec.template.spec.automountServiceAccountToken == false &&
        object.spec.template.spec.enableServiceLinks == false &&
        object.spec.template.spec.restartPolicy == 'Never' &&
        object.spec.template.spec.terminationGracePeriodSeconds == 0 &&
        object.spec.template.spec.securityContext.runAsNonRoot == true &&
        object.spec.template.spec.securityContext.runAsUser == 65532 &&
        object.spec.template.spec.securityContext.runAsGroup == 65532 &&
        object.spec.template.spec.securityContext.fsGroup == 65532 &&
        object.spec.template.spec.securityContext.seccompProfile.type == 'RuntimeDefault' &&
        object.spec.template.spec.initContainers.size() == 1 &&
        (!has(object.spec.template.spec.ephemeralContainers) || object.spec.template.spec.ephemeralContainers.size() == 0) &&
        object.spec.template.spec.initContainers[0].name == 'mcp-server' &&
        object.spec.template.spec.initContainers[0].restartPolicy == 'Always' &&
        object.spec.template.spec.initContainers[0].image.matches('^[a-z0-9][a-z0-9._:-]*(/[a-z0-9][a-z0-9._/-]*)+@sha256:[a-f0-9]{64}$') &&
        object.spec.template.spec.initContainers[0].imagePullPolicy == {{ $mcpExecutorValues.image.pullPolicy | toJson }} &&
        object.spec.template.spec.initContainers[0].securityContext.allowPrivilegeEscalation == false &&
        object.spec.template.spec.initContainers[0].securityContext.readOnlyRootFilesystem == true &&
        object.spec.template.spec.initContainers[0].securityContext.capabilities.drop == ['ALL'] &&
        (!has(object.spec.template.spec.initContainers[0].securityContext.capabilities.add) || object.spec.template.spec.initContainers[0].securityContext.capabilities.add.size() == 0) &&
        (!has(object.spec.template.spec.initContainers[0].command) || object.spec.template.spec.initContainers[0].command.size() == 0) &&
        (!has(object.spec.template.spec.initContainers[0].args) || object.spec.template.spec.initContainers[0].args.size() == 0) &&
        !has(object.spec.template.spec.initContainers[0].lifecycle) &&
        !has(object.spec.template.spec.initContainers[0].livenessProbe) &&
        !has(object.spec.template.spec.initContainers[0].readinessProbe) &&
        !has(object.spec.template.spec.initContainers[0].startupProbe) &&
        !has(object.spec.template.spec.initContainers[0].env) &&
        !has(object.spec.template.spec.initContainers[0].envFrom) &&
        object.spec.template.spec.initContainers[0].resources.requests.cpu == {{ $mcpExecutorValues.serverResources.requests.cpu | toString | toJson }} &&
        object.spec.template.spec.initContainers[0].resources.requests.memory == {{ $mcpExecutorValues.serverResources.requests.memory | toString | toJson }} &&
        object.spec.template.spec.initContainers[0].resources.limits.cpu == {{ $mcpExecutorValues.serverResources.limits.cpu | toString | toJson }} &&
        object.spec.template.spec.initContainers[0].resources.limits.memory == {{ $mcpExecutorValues.serverResources.limits.memory | toString | toJson }} &&
        object.spec.template.spec.initContainers[0].volumeMounts.size() == 1 &&
        object.spec.template.spec.initContainers[0].volumeMounts[0].name == 'server-scratch' &&
        object.spec.template.spec.initContainers[0].volumeMounts[0].mountPath == '/tmp' &&
        object.spec.template.spec.containers.size() == 1 &&
        object.spec.template.spec.containers[0].name == 'mcp-companion' &&
        object.spec.template.spec.containers[0].image == {{ $mcpCompanionImage | toJson }} &&
        object.spec.template.spec.containers[0].imagePullPolicy == {{ $mcpExecutorValues.image.pullPolicy | toJson }} &&
        object.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation == false &&
        object.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem == true &&
        object.spec.template.spec.containers[0].securityContext.capabilities.drop == ['ALL'] &&
        (!has(object.spec.template.spec.containers[0].securityContext.capabilities.add) || object.spec.template.spec.containers[0].securityContext.capabilities.add.size() == 0) &&
        (!has(object.spec.template.spec.containers[0].command) || object.spec.template.spec.containers[0].command.size() == 0) &&
        (!has(object.spec.template.spec.containers[0].args) || object.spec.template.spec.containers[0].args.size() == 0) &&
        !has(object.spec.template.spec.containers[0].lifecycle) &&
        !has(object.spec.template.spec.containers[0].livenessProbe) &&
        !has(object.spec.template.spec.containers[0].readinessProbe) &&
        !has(object.spec.template.spec.containers[0].startupProbe) &&
        !has(object.spec.template.spec.containers[0].envFrom) &&
        object.spec.template.spec.containers[0].env.size() == 5 &&
        object.spec.template.spec.containers[0].env[0].name == 'OPENCRANE_MCP_EXECUTOR_URL' &&
        object.spec.template.spec.containers[0].env[0].value == {{ $mcpInternalUrl | toJson }} &&
        object.spec.template.spec.containers[0].env[1].name == 'OPENCRANE_MCP_SERVER_URL' &&
        object.spec.template.spec.containers[0].env[1].value == 'http://127.0.0.1:3000/mcp' &&
        object.spec.template.spec.containers[0].env[2].name == 'OPENCRANE_MCP_TOKEN_PATH' &&
        object.spec.template.spec.containers[0].env[2].value == '/var/run/opencrane/tokens/executor.token' &&
        object.spec.template.spec.containers[0].env[3].name == 'OPENCRANE_MCP_CLAIM_REFERENCE_PATH' &&
        object.spec.template.spec.containers[0].env[3].value == '/var/run/opencrane/claim/reference' &&
        object.spec.template.spec.containers[0].env[4].name == 'POD_UID' &&
        object.spec.template.spec.containers[0].env[4].valueFrom.fieldRef.fieldPath == 'metadata.uid' &&
        object.spec.template.spec.containers[0].resources.requests.cpu == {{ $mcpExecutorValues.companionResources.requests.cpu | toString | toJson }} &&
        object.spec.template.spec.containers[0].resources.requests.memory == {{ $mcpExecutorValues.companionResources.requests.memory | toString | toJson }} &&
        object.spec.template.spec.containers[0].resources.limits.cpu == {{ $mcpExecutorValues.companionResources.limits.cpu | toString | toJson }} &&
        object.spec.template.spec.containers[0].resources.limits.memory == {{ $mcpExecutorValues.companionResources.limits.memory | toString | toJson }} &&
        object.spec.template.spec.containers[0].volumeMounts.size() == 3 &&
        object.spec.template.spec.containers[0].volumeMounts[0].name == 'executor-token' &&
        object.spec.template.spec.containers[0].volumeMounts[0].mountPath == '/var/run/opencrane/tokens' &&
        object.spec.template.spec.containers[0].volumeMounts[0].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[1].name == 'claim-reference' &&
        object.spec.template.spec.containers[0].volumeMounts[1].mountPath == '/var/run/opencrane/claim' &&
        object.spec.template.spec.containers[0].volumeMounts[1].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[2].name == 'companion-scratch' &&
        object.spec.template.spec.containers[0].volumeMounts[2].mountPath == '/tmp' &&
        object.spec.template.spec.volumes.size() == 4 &&
        object.spec.template.spec.volumes[0].name == 'executor-token' &&
        object.spec.template.spec.volumes[0].projected.defaultMode == 288 &&
        object.spec.template.spec.volumes[0].projected.sources.size() == 1 &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-mcp-executor' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.path == 'executor.token' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.expirationSeconds == {{ $mcpExecutorValues.projectedTokenTtlSeconds }} &&
        object.spec.template.spec.volumes[1].name == 'claim-reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.defaultMode == 288 &&
        object.spec.template.spec.volumes[1].downwardAPI.items.size() == 1 &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].path == 'reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].fieldRef.fieldPath == "metadata.annotations['opencrane.ai/mcp-execution-reference']" &&
        object.spec.template.spec.volumes[2].name == 'server-scratch' &&
        quantity(object.spec.template.spec.volumes[2].emptyDir.sizeLimit).compareTo(quantity({{ $mcpExecutorValues.scratchSize | toJson }})) == 0 &&
        object.spec.template.spec.volumes[3].name == 'companion-scratch' &&
        quantity(object.spec.template.spec.volumes[3].emptyDir.sizeLimit).compareTo(quantity({{ $mcpExecutorValues.scratchSize | toJson }})) == 0 &&
        object.spec.template.metadata.labels == object.metadata.labels &&
        object.spec.template.metadata.annotations == object.metadata.annotations &&
        (!has(object.spec.template.metadata.ownerReferences) || object.spec.template.metadata.ownerReferences.size() == 0) &&
        (!has(object.spec.template.metadata.finalizers) || object.spec.template.metadata.finalizers.size() == 0) &&
        (!has(object.spec.template.metadata.name) || object.spec.template.metadata.name == '') &&
        (!has(object.spec.template.metadata.generateName) || object.spec.template.metadata.generateName == '') &&
        (!has(object.spec.template.metadata.namespace) || object.spec.template.metadata.namespace == '')
      message: MCP executor Job must keep the fixed token-isolated two-container shape
    - expression: >-
        request.operation == 'CREATE' ||
        (oldObject.spec.suspend == true && object.spec.suspend == false &&
         object.metadata.name == oldObject.metadata.name && object.metadata.labels == oldObject.metadata.labels &&
         object.metadata.annotations == oldObject.metadata.annotations && object.spec.parallelism == oldObject.spec.parallelism &&
         object.spec.completions == oldObject.spec.completions && object.spec.backoffLimit == oldObject.spec.backoffLimit &&
         object.spec.ttlSecondsAfterFinished == oldObject.spec.ttlSecondsAfterFinished &&
         object.spec.activeDeadlineSeconds > 0 && object.spec.activeDeadlineSeconds <= oldObject.spec.activeDeadlineSeconds &&
         object.spec.template == oldObject.spec.template)
      message: an MCP executor Job update may only release its saved suspended template once
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ $mcpAdmissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: mcp-executor
spec:
  policyName: {{ $mcpAdmissionName }}
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels:
        app.kubernetes.io/component: mcp-executor
---
# The skill controller has Job create/get in the authoring namespace only. Admission makes that generic
# Kubernetes verb safe: it can create only the exact suspended worker envelopes produced by the
# governed-skill builder, never arbitrary or immediately executable Jobs.
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ $skillAdmissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: skill-authoring-validation
spec:
  failurePolicy: Fail
  matchConstraints:
    matchPolicy: Exact
    resourceRules:
      - apiGroups: ["batch"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["jobs"]
        scope: "Namespaced"
    namespaceSelector:
      matchExpressions:
        - key: app.kubernetes.io/component
          operator: In
          values: ["skill-authoring"]
  validations:
    - expression: >-
        request.userInfo.username == {{ $controllerUsername | toJson }}
      message: only this release's controller ServiceAccount may create governed skill Jobs
    - expression: >-
        request.operation == 'UPDATE' || (object.metadata.namespace == {{ $authoringNamespace | toJson }} &&
          object.metadata.name.matches('^skill-author-[a-f0-9]{24}$') &&
          object.metadata.labels.size() == 3 &&
          object.metadata.labels['app.kubernetes.io/name'] == 'opencrane-skill-authoring' &&
          object.metadata.labels['app.kubernetes.io/component'] == 'skill-authoring') &&
        object.metadata.labels['opencrane.ai/skill-authoring-validation'] == object.metadata.name &&
        object.metadata.annotations.size() == 3 &&
        object.metadata.annotations['opencrane.ai/silo-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/job-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/capability-reference'].matches('^skill-bootstrap-v1_[a-f0-9]{64}$') &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0) &&
        (!has(object.metadata.generateName) || object.metadata.generateName == '')
      message: governed skill Job identity must exactly match its isolated workload class
    - expression: >-
        request.operation == 'UPDATE' || (object.spec.suspend == true && object.spec.parallelism == 1 && object.spec.completions == 1 &&
        object.spec.backoffLimit == 0 && object.spec.ttlSecondsAfterFinished == 0 &&
        (object.metadata.namespace == {{ $authoringNamespace | toJson }} &&
          object.spec.activeDeadlineSeconds == {{ .Values.agentController.skillAuthoringValidation.activeDeadlineSeconds }} &&
          object.spec.template.spec.serviceAccountName == 'skill-authoring-default' &&
          object.spec.template.metadata.labels['app.kubernetes.io/component'] == 'skill-authoring' &&
          object.spec.template.spec.containers[0].name == 'skill-authoring' &&
          object.spec.template.spec.containers[0].image == {{ $authoringImage | toJson }} &&
          object.spec.template.spec.containers[0].imagePullPolicy == {{ .Values.agentController.skillAuthoringValidation.image.pullPolicy | toJson }} &&
          object.spec.template.spec.containers[0].resources.requests.cpu == {{ .Values.agentController.skillAuthoringValidation.resources.requests.cpu | toString | toJson }} &&
          object.spec.template.spec.containers[0].resources.requests.memory == {{ .Values.agentController.skillAuthoringValidation.resources.requests.memory | toString | toJson }} &&
          object.spec.template.spec.containers[0].resources.limits.cpu == {{ .Values.agentController.skillAuthoringValidation.resources.limits.cpu | toString | toJson }} &&
          object.spec.template.spec.containers[0].resources.limits.memory == {{ .Values.agentController.skillAuthoringValidation.resources.limits.memory | toString | toJson }} &&
          object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-skill-authoring' &&
          quantity(object.spec.template.spec.volumes[2].emptyDir.sizeLimit).compareTo(quantity({{ .Values.agentController.skillAuthoringValidation.scratchSize | toJson }})) == 0) &&
        object.spec.template.spec.containers.size() == 1 &&
        (!has(object.spec.template.spec.initContainers) || object.spec.template.spec.initContainers.size() == 0) &&
        (!has(object.spec.template.spec.ephemeralContainers) || object.spec.template.spec.ephemeralContainers.size() == 0) &&
        object.spec.template.spec.automountServiceAccountToken == false &&
        object.spec.template.spec.enableServiceLinks == false &&
        object.spec.template.spec.restartPolicy == 'Never' &&
        object.spec.template.spec.securityContext.runAsNonRoot == true &&
        object.spec.template.spec.securityContext.runAsUser == 65532 &&
        object.spec.template.spec.securityContext.runAsGroup == 65532 &&
        object.spec.template.spec.securityContext.fsGroup == 65532 &&
        object.spec.template.spec.securityContext.seccompProfile.type == 'RuntimeDefault' &&
        object.spec.template.spec.terminationGracePeriodSeconds == 0 &&
        object.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation == false &&
        object.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem == true &&
        object.spec.template.spec.containers[0].securityContext.capabilities.drop == ['ALL'] &&
        (!has(object.spec.template.spec.containers[0].securityContext.capabilities.add) || object.spec.template.spec.containers[0].securityContext.capabilities.add.size() == 0) &&
        (!has(object.spec.template.spec.containers[0].command) || object.spec.template.spec.containers[0].command.size() == 0) &&
        (!has(object.spec.template.spec.containers[0].args) || object.spec.template.spec.containers[0].args.size() == 0) &&
        !has(object.spec.template.spec.containers[0].lifecycle) &&
        !has(object.spec.template.spec.containers[0].livenessProbe) &&
        !has(object.spec.template.spec.containers[0].readinessProbe) &&
        !has(object.spec.template.spec.containers[0].startupProbe) &&
        !has(object.spec.template.spec.containers[0].envFrom) &&
        object.spec.template.spec.containers[0].env.size() == 3 &&
        object.spec.template.spec.containers[0].env[0].name == 'OPENCRANE_SKILL_BOOTSTRAP_URL' &&
        object.spec.template.spec.containers[0].env[0].value == {{ $skillBootstrapUrl | toJson }} &&
        object.spec.template.spec.containers[0].env[1].name == 'OPENCRANE_SKILL_TOKEN_PATH' &&
        object.spec.template.spec.containers[0].env[1].value == '/var/run/opencrane/tokens/capability.token' &&
        object.spec.template.spec.containers[0].env[2].name == 'OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH' &&
        object.spec.template.spec.containers[0].env[2].value == '/var/run/opencrane/bootstrap/reference' &&
        object.spec.template.spec.containers[0].volumeMounts.size() == 3 &&
        object.spec.template.spec.containers[0].volumeMounts[0].name == 'capability-token' &&
        object.spec.template.spec.containers[0].volumeMounts[0].mountPath == '/var/run/opencrane/tokens' &&
        object.spec.template.spec.containers[0].volumeMounts[0].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[1].name == 'bootstrap-reference' &&
        object.spec.template.spec.containers[0].volumeMounts[1].mountPath == '/var/run/opencrane/bootstrap' &&
        object.spec.template.spec.containers[0].volumeMounts[1].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[2].name == 'scratch' &&
        object.spec.template.spec.containers[0].volumeMounts[2].mountPath == '/tmp' &&
        object.spec.template.spec.volumes.size() == 3 &&
        object.spec.template.spec.volumes[0].name == 'capability-token' &&
        object.spec.template.spec.volumes[0].projected.defaultMode == 288 &&
        object.spec.template.spec.volumes[0].projected.sources.size() == 1 &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.path == 'capability.token' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.expirationSeconds == 600 &&
        object.spec.template.spec.volumes[1].name == 'bootstrap-reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.defaultMode == 288 &&
        object.spec.template.spec.volumes[1].downwardAPI.items.size() == 1 &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].path == 'reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].fieldRef.fieldPath == "metadata.annotations['opencrane.ai/capability-reference']" &&
        object.spec.template.spec.volumes[2].name == 'scratch' &&
        object.spec.template.metadata.labels.size() == 2 &&
        object.spec.template.metadata.labels['app.kubernetes.io/component'] == object.metadata.labels['app.kubernetes.io/component'] &&
        object.spec.template.metadata.labels['opencrane.ai/skill-authoring-validation'] == object.metadata.labels['opencrane.ai/skill-authoring-validation'] &&
        object.spec.template.metadata.annotations.size() == 3 &&
        object.spec.template.metadata.annotations['opencrane.ai/silo-id'] == object.metadata.annotations['opencrane.ai/silo-id'] &&
        object.spec.template.metadata.annotations['opencrane.ai/job-id'] == object.metadata.annotations['opencrane.ai/job-id'] &&
        object.spec.template.metadata.annotations['opencrane.ai/capability-reference'] == object.metadata.annotations['opencrane.ai/capability-reference'] &&
        (!has(object.spec.template.metadata.ownerReferences) || object.spec.template.metadata.ownerReferences.size() == 0) &&
        (!has(object.spec.template.metadata.finalizers) || object.spec.template.metadata.finalizers.size() == 0) &&
        (!has(object.spec.template.metadata.name) || object.spec.template.metadata.name == '') &&
        (!has(object.spec.template.metadata.generateName) || object.spec.template.metadata.generateName == '') &&
        (!has(object.spec.template.metadata.namespace) || object.spec.template.metadata.namespace == ''))
      message: governed skill Job must remain the exact suspended, class-bounded worker shape
    - expression: >-
        request.operation == 'CREATE' ||
        (oldObject.spec.suspend == true && object.spec.suspend == false &&
         object.metadata.name == oldObject.metadata.name && object.metadata.labels == oldObject.metadata.labels &&
         object.metadata.annotations == oldObject.metadata.annotations && object.spec.parallelism == oldObject.spec.parallelism &&
         object.spec.completions == oldObject.spec.completions && object.spec.backoffLimit == oldObject.spec.backoffLimit &&
         object.spec.ttlSecondsAfterFinished == oldObject.spec.ttlSecondsAfterFinished &&
         object.spec.activeDeadlineSeconds > 0 && object.spec.activeDeadlineSeconds <= oldObject.spec.activeDeadlineSeconds &&
         object.spec.template == oldObject.spec.template)
      message: a governed skill Job update may only release its exact suspended template once
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ $skillAdmissionName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: skill-authoring-validation
spec:
  policyName: {{ $skillAdmissionName }}
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchExpressions:
        - key: app.kubernetes.io/component
          operator: In
          values: ["skill-authoring"]
---
{{ include "opencrane.agentController.warmRuntimeResources" . }}
{{- end }}
{{- end }}
