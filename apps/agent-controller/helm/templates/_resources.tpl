{{/* Resolve and validate the namespace that contains only personal-runtime Jobs and their zero-RBAC identity. */}}
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
{{- if not .Values.agentController.kubernetesApiServerCidrs }}
{{- fail "agentController.enabled=true requires at least one exact agentController.kubernetesApiServerCidrs entry for bounded Kubernetes API egress" }}
{{- end }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.agentController.image.digest) }}
{{- fail "agentController.enabled=true requires an immutable sha256 agentController.image.digest" }}
{{- end }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.agentController.runtimeProfile.image.digest) }}
{{- fail "agentController.enabled=true requires an immutable sha256 agentController.runtimeProfile.image.digest" }}
{{- end }}
{{- $controllerName := "agent-controller" -}}
{{- $runtimeNamespace := include "opencrane.agentController.runtimeNamespace" . -}}
{{- $runtimeNamespaceLabel := include "opencrane.agentController.runtimeNamespaceLabelValue" . -}}
{{- $runtimeServiceAccount := default "agent-runtime-default" .Values.agentController.runtimeProfile.serviceAccountName -}}
{{- if or (gt (len $runtimeServiceAccount) 63) (not (regexMatch "^agent-runtime-[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $runtimeServiceAccount)) -}}
{{- fail "agentController.runtimeProfile.serviceAccountName must be a bounded agent-runtime-* identity" -}}
{{- end -}}
{{- $openCraneInternalUrl := default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort) .Values.agentController.openCraneInternalUrl -}}
{{- $runtimeStreamUrl := default (printf "%s/api/internal/agent-runtime" $openCraneInternalUrl) .Values.agentController.runtimeProfile.runtimeStreamUrl -}}
{{- $runtimeImage := printf "%s@%s" .Values.agentController.runtimeProfile.image.repository .Values.agentController.runtimeProfile.image.digest -}}
{{- $controllerImage := printf "%s@%s" .Values.agentController.image.repository .Values.agentController.image.digest -}}
{{- $controllerUsername := printf "system:serviceaccount:%s:%s" .Release.Namespace $controllerName -}}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ $runtimeNamespace }}
  labels:
    opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $controllerName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-controller
automountServiceAccountToken: false
---
# Runtime Jobs share one bounded identity class in their dedicated namespace. No RoleBinding grants
# this ServiceAccount Kubernetes API access.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $runtimeServiceAccount }}
  namespace: {{ $runtimeNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
automountServiceAccountToken: false
---
# Aggregate namespace ceiling: a compromised controller identity may request only the one admitted
# Job shape, and this quota bounds how many of those shapes can consume cluster resources at once.
apiVersion: v1
kind: ResourceQuota
metadata:
  name: {{ include "opencrane.fullname" . }}-agent-runtime
  namespace: {{ $runtimeNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  hard:
    pods: {{ .Values.agentController.runtimeQuota.pods | quote }}
    count/jobs.batch: {{ .Values.agentController.runtimeQuota.jobs | quote }}
    requests.cpu: {{ .Values.agentController.runtimeQuota.requests.cpu | quote }}
    requests.memory: {{ .Values.agentController.runtimeQuota.requests.memory | quote }}
    limits.cpu: {{ .Values.agentController.runtimeQuota.limits.cpu | quote }}
    limits.memory: {{ .Values.agentController.runtimeQuota.limits.memory | quote }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $controllerName }}
  namespace: {{ $runtimeNamespace }}
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
  name: {{ $controllerName }}
  namespace: {{ $runtimeNamespace }}
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
  name: {{ $controllerName }}
---
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
            - name: OPENCRANE_INTERNAL_URL
              value: {{ $openCraneInternalUrl | quote }}
            - name: OPENCRANE_CONTROLLER_TOKEN_PATH
              value: /var/run/opencrane/tokens/opencrane.token
            - name: AGENT_RUNTIME_NAMESPACE
              value: {{ $runtimeNamespace | quote }}
            - name: AGENT_CONTROLLER_POLL_INTERVAL_MS
              value: {{ .Values.agentController.pollIntervalMs | quote }}
            - name: AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS
              value: {{ .Values.agentController.outboxPruneIntervalMs | quote }}
            - name: AGENT_CONTROLLER_PROFILES_JSON
              value: {{ dict .Values.agentController.runtimeProfile.name (dict "image" $runtimeImage "imagePullPolicy" .Values.agentController.runtimeProfile.image.pullPolicy "runtimeStreamUrl" $runtimeStreamUrl "serverNamespace" .Release.Namespace "serviceAccountName" $runtimeServiceAccount "projectedTokenTtlSeconds" .Values.agentController.runtimeProfile.projectedTokenTtlSeconds "scratchSize" .Values.agentController.runtimeProfile.scratchSize "activeDeadlineSeconds" .Values.agentController.runtimeProfile.activeDeadlineSeconds "ttlSecondsAfterFinished" .Values.agentController.runtimeProfile.ttlSecondsAfterFinished "resources" .Values.agentController.runtimeProfile.resources) | toJson | quote }}
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
    - to:
        {{- range .Values.agentController.kubernetesApiServerCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ .Values.agentController.kubernetesApiServerPort }}
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
# Namespace-wide default deny. Only the fixed runtime policy below admits traffic for runtime Pods.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-agent-runtime-default-deny
  namespace: {{ $runtimeNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
  ingress: []
  egress: []
---
# Every runtime uses this immutable egress floor; the controller has no NetworkPolicy permissions.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-agent-runtime-egress
  namespace: {{ $runtimeNamespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: agent-runtime
  policyTypes: ["Egress"]
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
---
# The policy is cluster-scoped only because Kubernetes admission policies are cluster-scoped. Its
# namespace selector binds it to this one Helm-owned namespace label; no controller RBAC covers it.
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ include "opencrane.agentController.admissionName" . }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  failurePolicy: Fail
  matchPolicy: Exact
  matchConstraints:
    resourceRules:
      - apiGroups: ["batch"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["jobs"]
        scope: "Namespaced"
    namespaceSelector:
      matchLabels:
        opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
  validations:
    - expression: >-
        request.userInfo.username == {{ $controllerUsername | toJson }} && request.subResource == ""
      message: only this release's controller ServiceAccount may create or release runtime Jobs
    - expression: >-
        object.metadata.name.matches('^agent-runtime-a[1-9][0-9]*-[a-f0-9]{24}$') &&
        object.metadata.namespace == {{ $runtimeNamespace | toJson }} &&
        object.metadata.labels.size() >= 3 && object.metadata.labels.size() <= 7 &&
        object.metadata.labels.all(k, k in [
          'app.kubernetes.io/name', 'app.kubernetes.io/component', 'opencrane.ai/runtime-attempt',
          'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name',
          'controller-uid', 'job-name']) &&
        object.metadata.labels['app.kubernetes.io/name'] == 'opencrane-agent-runtime' &&
        object.metadata.labels['app.kubernetes.io/component'] == 'agent-runtime' &&
        object.metadata.labels['opencrane.ai/runtime-attempt'] == object.metadata.name &&
        (!('batch.kubernetes.io/job-name' in object.metadata.labels) || object.metadata.labels['batch.kubernetes.io/job-name'] == object.metadata.name) &&
        (!('job-name' in object.metadata.labels) || object.metadata.labels['job-name'] == object.metadata.name) &&
        (!has(object.metadata.uid) || !('batch.kubernetes.io/controller-uid' in object.metadata.labels) || object.metadata.labels['batch.kubernetes.io/controller-uid'] == string(object.metadata.uid)) &&
        (!has(object.metadata.uid) || !('controller-uid' in object.metadata.labels) || object.metadata.labels['controller-uid'] == string(object.metadata.uid)) &&
        object.metadata.annotations.size() == 5 &&
        object.metadata.annotations['opencrane.ai/run-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/run-attempt'].matches('^[1-9][0-9]*$') &&
        object.metadata.annotations['opencrane.ai/agent-service-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/agent-revision-id'].size() > 0 &&
        object.metadata.annotations['opencrane.ai/silo-id'].size() > 0 &&
        (!has(object.metadata.ownerReferences) || object.metadata.ownerReferences.size() == 0) &&
        (!has(object.metadata.finalizers) || object.metadata.finalizers.size() == 0) &&
        (!has(object.metadata.generateName) || object.metadata.generateName == '')
      message: runtime Job identity must exactly match one durable OpenCrane attempt
    - expression: >-
        object.spec.parallelism == 1 && object.spec.completions == 1 && object.spec.backoffLimit == 0 &&
        object.spec.activeDeadlineSeconds > 0 &&
        object.spec.activeDeadlineSeconds <= {{ .Values.agentController.runtimeProfile.activeDeadlineSeconds }} &&
        object.spec.ttlSecondsAfterFinished == {{ .Values.agentController.runtimeProfile.ttlSecondsAfterFinished }} &&
        (!has(object.spec.manualSelector) || object.spec.manualSelector == false) &&
        (!has(object.spec.completionMode) || object.spec.completionMode == 'NonIndexed') &&
        !has(object.spec.podFailurePolicy) && !has(object.spec.successPolicy) &&
        !has(object.spec.backoffLimitPerIndex) && !has(object.spec.maxFailedIndexes) &&
        object.spec.template.metadata.labels.size() >= 3 && object.spec.template.metadata.labels.size() <= 7 &&
        object.spec.template.metadata.labels.all(k, k in [
          'app.kubernetes.io/name', 'app.kubernetes.io/component', 'opencrane.ai/runtime-attempt',
          'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name',
          'controller-uid', 'job-name']) &&
        object.spec.template.metadata.labels['app.kubernetes.io/name'] == object.metadata.labels['app.kubernetes.io/name'] &&
        object.spec.template.metadata.labels['app.kubernetes.io/component'] == object.metadata.labels['app.kubernetes.io/component'] &&
        object.spec.template.metadata.labels['opencrane.ai/runtime-attempt'] == object.metadata.labels['opencrane.ai/runtime-attempt'] &&
        (!('batch.kubernetes.io/job-name' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['batch.kubernetes.io/job-name'] == object.metadata.name) &&
        (!('job-name' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['job-name'] == object.metadata.name) &&
        (!has(object.metadata.uid) || !('batch.kubernetes.io/controller-uid' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['batch.kubernetes.io/controller-uid'] == string(object.metadata.uid)) &&
        (!has(object.metadata.uid) || !('controller-uid' in object.spec.template.metadata.labels) || object.spec.template.metadata.labels['controller-uid'] == string(object.metadata.uid)) &&
        object.spec.template.metadata.annotations.size() == 6 &&
        object.spec.template.metadata.annotations['opencrane.ai/run-id'] == object.metadata.annotations['opencrane.ai/run-id'] &&
        object.spec.template.metadata.annotations['opencrane.ai/run-attempt'] == object.metadata.annotations['opencrane.ai/run-attempt'] &&
        object.spec.template.metadata.annotations['opencrane.ai/agent-service-id'] == object.metadata.annotations['opencrane.ai/agent-service-id'] &&
        object.spec.template.metadata.annotations['opencrane.ai/agent-revision-id'] == object.metadata.annotations['opencrane.ai/agent-revision-id'] &&
        object.spec.template.metadata.annotations['opencrane.ai/silo-id'] == object.metadata.annotations['opencrane.ai/silo-id'] &&
        object.spec.template.metadata.annotations['opencrane.ai/bootstrap-reference'].matches('^bootstrap-v1_[a-f0-9]{64}$') &&
        (!has(object.spec.template.metadata.name) || object.spec.template.metadata.name == '') &&
        (!has(object.spec.template.metadata.generateName) || object.spec.template.metadata.generateName == '') &&
        (!has(object.spec.template.metadata.namespace) || object.spec.template.metadata.namespace == '') &&
        (!has(object.spec.template.metadata.ownerReferences) || object.spec.template.metadata.ownerReferences.size() == 0) &&
        (!has(object.spec.template.metadata.finalizers) || object.spec.template.metadata.finalizers.size() == 0)
      message: runtime Job lifecycle and authority annotations must match the immutable release profile
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
      message: only Kubernetes-owned Job selector labels may be defaulted by the API server
    - expression: >-
        object.spec.template.spec.serviceAccountName == {{ $runtimeServiceAccount | toJson }} &&
        (!has(object.spec.template.spec.serviceAccount) || object.spec.template.spec.serviceAccount == {{ $runtimeServiceAccount | toJson }}) &&
        object.spec.template.spec.automountServiceAccountToken == false &&
        object.spec.template.spec.enableServiceLinks == false &&
        object.spec.template.spec.restartPolicy == 'Never' &&
        object.spec.template.spec.securityContext.runAsNonRoot == true &&
        object.spec.template.spec.securityContext.runAsUser == 65532 &&
        object.spec.template.spec.securityContext.runAsGroup == 65532 &&
        object.spec.template.spec.securityContext.fsGroup == 65532 &&
        object.spec.template.spec.securityContext.fsGroupChangePolicy == 'OnRootMismatch' &&
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
      message: runtime Pod identity and host isolation must match the restricted profile
    - expression: >-
        object.spec.template.spec.containers.size() == 1 &&
        (!has(object.spec.template.spec.initContainers) || object.spec.template.spec.initContainers.size() == 0) &&
        (!has(object.spec.template.spec.ephemeralContainers) || object.spec.template.spec.ephemeralContainers.size() == 0) &&
        object.spec.template.spec.containers[0].name == 'agent-runtime' &&
        object.spec.template.spec.containers[0].image == {{ $runtimeImage | toJson }} &&
        object.spec.template.spec.containers[0].imagePullPolicy == {{ .Values.agentController.runtimeProfile.image.pullPolicy | toJson }} &&
        object.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation == false &&
        object.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem == true &&
        object.spec.template.spec.containers[0].securityContext.capabilities.drop == ['ALL'] &&
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
        quantity(object.spec.template.spec.containers[0].resources.requests.cpu).compareTo(quantity({{ .Values.agentController.runtimeProfile.resources.requests.cpu | toJson }})) == 0 &&
        quantity(object.spec.template.spec.containers[0].resources.requests.memory).compareTo(quantity({{ .Values.agentController.runtimeProfile.resources.requests.memory | toJson }})) == 0 &&
        quantity(object.spec.template.spec.containers[0].resources.limits.cpu).compareTo(quantity({{ .Values.agentController.runtimeProfile.resources.limits.cpu | toJson }})) == 0 &&
        quantity(object.spec.template.spec.containers[0].resources.limits.memory).compareTo(quantity({{ .Values.agentController.runtimeProfile.resources.limits.memory | toJson }})) == 0
      message: runtime image, container shape, security and resources are immutable
    - expression: >-
        object.spec.template.spec.containers[0].env.size() == 3 &&
        object.spec.template.spec.containers[0].env[0].name == 'OPENCRANE_RUNTIME_STREAM_URL' &&
        object.spec.template.spec.containers[0].env[0].value == {{ $runtimeStreamUrl | toJson }} &&
        object.spec.template.spec.containers[0].env[1].name == 'OPENCRANE_RUNTIME_TOKEN_PATH' &&
        object.spec.template.spec.containers[0].env[1].value == '/var/run/opencrane/tokens/runtime.token' &&
        object.spec.template.spec.containers[0].env[2].name == 'POD_UID' &&
        object.spec.template.spec.containers[0].env[2].valueFrom.fieldRef.fieldPath == 'metadata.uid' &&
        object.spec.template.spec.containers[0].volumeMounts.size() == 3 &&
        object.spec.template.spec.containers[0].volumeMounts[0].name == 'runtime-token' &&
        object.spec.template.spec.containers[0].volumeMounts[0].mountPath == '/var/run/opencrane/tokens' &&
        object.spec.template.spec.containers[0].volumeMounts[0].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[1].name == 'runtime-bootstrap' &&
        object.spec.template.spec.containers[0].volumeMounts[1].mountPath == '/var/run/opencrane/bootstrap' &&
        object.spec.template.spec.containers[0].volumeMounts[1].readOnly == true &&
        object.spec.template.spec.containers[0].volumeMounts[2].name == 'scratch' &&
        object.spec.template.spec.containers[0].volumeMounts[2].mountPath == '/tmp' &&
        (!has(object.spec.template.spec.containers[0].volumeMounts[2].readOnly) || object.spec.template.spec.containers[0].volumeMounts[2].readOnly == false)
      message: runtime environment and mounts must contain only the fixed non-secret interfaces
    - expression: >-
        object.spec.template.spec.volumes.size() == 3 &&
        object.spec.template.spec.volumes[0].name == 'runtime-token' &&
        object.spec.template.spec.volumes[0].projected.defaultMode == 288 &&
        object.spec.template.spec.volumes[0].projected.sources.size() == 1 &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.path == 'runtime.token' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-agent-runtime' &&
        object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.expirationSeconds == {{ .Values.agentController.runtimeProfile.projectedTokenTtlSeconds }} &&
        object.spec.template.spec.volumes[1].name == 'runtime-bootstrap' &&
        object.spec.template.spec.volumes[1].downwardAPI.defaultMode == 288 &&
        object.spec.template.spec.volumes[1].downwardAPI.items.size() == 1 &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].path == 'reference' &&
        object.spec.template.spec.volumes[1].downwardAPI.items[0].fieldRef.fieldPath == "metadata.annotations['opencrane.ai/bootstrap-reference']" &&
        object.spec.template.spec.volumes[2].name == 'scratch' &&
        (!has(object.spec.template.spec.volumes[2].emptyDir.medium) || object.spec.template.spec.volumes[2].emptyDir.medium == '') &&
        quantity(object.spec.template.spec.volumes[2].emptyDir.sizeLimit).compareTo(quantity({{ .Values.agentController.runtimeProfile.scratchSize | toJson }})) == 0
      message: runtime volumes must be exactly one audience token, one reference and bounded scratch
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
          object.spec.ttlSecondsAfterFinished == oldObject.spec.ttlSecondsAfterFinished &&
          object.spec.template == oldObject.spec.template)
      message: create must be suspended and update may only release the exact stored Job once
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ include "opencrane.agentController.admissionName" . }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: agent-runtime
spec:
  policyName: {{ include "opencrane.agentController.admissionName" . }}
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels:
        opencrane.ai/runtime-release: {{ $runtimeNamespaceLabel | quote }}
{{- end }}
{{- end }}
