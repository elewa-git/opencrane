{{/* Render two fixed warm pools whose Pods are claimed once and replaced after use. */}}
{{- define "opencrane.agentController.warmRuntimeResources" -}}
{{- $warm := .Values.agentController.warmRuntime -}}
{{- $replicas := int $warm.replicas -}}
{{- if or (lt $replicas 2) (gt $replicas 5) -}}
{{- fail "agentController.warmRuntime.replicas must be between 2 and 5" -}}
{{- end -}}
{{- $personalNamespace := include "opencrane.agentController.runtimeNamespace" . -}}
{{- $managedNamespace := default (printf "%s-managed-runtime" .Release.Name | trunc 63 | trimSuffix "-") .Values.managedAgentRuntimePlane.managedAgentRuntime.namespace -}}
{{- $image := printf "%s@%s" .Values.agentController.runtimeProfile.image.repository .Values.agentController.runtimeProfile.image.digest -}}
{{- $serverUrl := default (printf "http://%s-opencrane-server.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort) .Values.agentController.openCraneInternalUrl -}}
{{- $litellmUrl := printf "http://%s-litellm.%s.svc.cluster.local:%v" (include "opencrane.fullname" .) .Release.Namespace .Values.litellm.service.port -}}
{{- $pools := list (dict "name" "personal-warm" "namespace" $personalNamespace "claimedProfile" $warm.personalProfile) (dict "name" "managed-warm" "namespace" $managedNamespace "claimedProfile" $warm.managedProfile) -}}
{{- range $pool := $pools }}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $warm.serviceAccountName }}
  namespace: {{ $pool.namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: warm-runtime
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}
  namespace: {{ $pool.namespace }}
  labels:
    {{- include "opencrane.labels" $ | nindent 4 }}
    app.kubernetes.io/component: warm-runtime
    opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}
spec:
  replicas: {{ $replicas }}
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector:
    matchLabels:
      opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/component: warm-runtime
        opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}
        opencrane.ai/warm-runtime-profile: {{ $warm.genericProfile }}
    spec:
      automountServiceAccountToken: false
      serviceAccountName: {{ $warm.serviceAccountName }}
      enableServiceLinks: false
      restartPolicy: Always
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: agent-runtime
          image: {{ $image }}
          imagePullPolicy: {{ $.Values.agentController.runtimeProfile.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          env:
            - { name: OPENCRANE_RUNTIME_STREAM_URL, value: {{ printf "%s/api/internal/warm-runtime" $serverUrl | quote }} }
            - { name: OPENCRANE_RUNTIME_TOKEN_PATH, value: /var/run/opencrane/tokens/warm.token }
            - { name: OPENCRANE_RUNTIME_LITELLM_BASE_URL, value: {{ $litellmUrl | quote }} }
            - { name: OPENCRANE_WARM_BINDING_PORT, value: {{ $warm.bindingPort | quote }} }
            - { name: OPENCRANE_WARM_PROFILE, value: {{ $pool.claimedProfile | quote }} }
            - name: POD_UID
              valueFrom: { fieldRef: { fieldPath: metadata.uid } }
          ports:
            - { name: warm-binding, containerPort: {{ $warm.bindingPort }}, protocol: TCP }
          readinessProbe:
            httpGet: { path: /internal/warm-runtime/generic-readiness, port: warm-binding }
            periodSeconds: 1
            failureThreshold: 3
          volumeMounts:
            - { name: warm-token, mountPath: /var/run/opencrane/tokens, readOnly: true }
            - { name: scratch, mountPath: /tmp }
          resources:
            {{- toYaml $.Values.agentController.runtimeProfile.resources | nindent 12 }}
      volumes:
        - name: warm-token
          projected:
            defaultMode: 288
            sources:
              - serviceAccountToken:
                  path: warm.token
                  audience: {{ $warm.tokenAudience }}
                  expirationSeconds: {{ $.Values.agentController.runtimeProfile.projectedTokenTtlSeconds }}
        - name: scratch
          emptyDir: { sizeLimit: {{ $.Values.agentController.runtimeProfile.scratchSize }} }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ include "opencrane.fullname" $ }}-warm-runtime-controller
  namespace: {{ $pool.namespace }}
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ include "opencrane.fullname" $ }}-warm-runtime-controller
  namespace: {{ $pool.namespace }}
subjects:
  - kind: ServiceAccount
    name: agent-controller
    namespace: {{ $.Release.Namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ include "opencrane.fullname" $ }}-warm-runtime-controller
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ printf "%s-%s-warm" (include "opencrane.agentController.admissionName" $) $pool.name | trunc 63 | trimSuffix "-" }}
spec:
  failurePolicy: Fail
  matchConstraints:
    matchPolicy: Exact
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["UPDATE", "DELETE"]
        resources: ["pods"]
        scope: Namespaced
  validations:
    - expression: >-
        request.userInfo.username == {{ printf "system:serviceaccount:%s:agent-controller" $.Release.Namespace | toJson }}
      message: only this release's agent controller may change or delete warm runtime Pods
    - expression: >-
        oldObject.metadata.labels['opencrane.ai/warm-runtime-pool'] == {{ printf "%s-%s" (include "opencrane.fullname" $) $pool.name | toJson }} &&
        oldObject.metadata.ownerReferences.size() == 1 && oldObject.metadata.ownerReferences[0].controller == true
      message: the Pod must belong to the fixed warm pool
    - expression: >-
        request.operation == 'DELETE' ||
        (object.metadata.uid == oldObject.metadata.uid &&
         object.metadata.name == oldObject.metadata.name &&
         object.metadata.namespace == oldObject.metadata.namespace &&
         object.metadata.annotations == oldObject.metadata.annotations &&
         object.metadata.ownerReferences == oldObject.metadata.ownerReferences &&
         object.spec == oldObject.spec && object.status == oldObject.status &&
         oldObject.metadata.labels['opencrane.ai/warm-runtime-profile'] == {{ $warm.genericProfile | toJson }} &&
         object.metadata.labels['opencrane.ai/warm-runtime-profile'] == {{ $pool.claimedProfile | toJson }} &&
         object.metadata.labels.all(key, key == 'opencrane.ai/warm-runtime-profile' || object.metadata.labels[key] == oldObject.metadata.labels[key]) &&
         oldObject.metadata.labels.all(key, key == 'opencrane.ai/warm-runtime-profile' || object.metadata.labels[key] == oldObject.metadata.labels[key]))
      message: a warm Pod update may only activate its fixed profile once
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ printf "%s-%s-warm" (include "opencrane.agentController.admissionName" $) $pool.name | trunc 63 | trimSuffix "-" }}
spec:
  policyName: {{ printf "%s-%s-warm" (include "opencrane.agentController.admissionName" $) $pool.name | trunc 63 | trimSuffix "-" }}
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: {{ $pool.namespace | quote }}
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}-generic
  namespace: {{ $pool.namespace }}
spec:
  endpointSelector:
    matchLabels:
      opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}
      opencrane.ai/warm-runtime-profile: {{ $warm.genericProfile }}
  ingress: []
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: {{ $.Release.Namespace }}
            k8s:app.kubernetes.io/component: opencrane-server
      toPorts:
        - ports:
            - { port: {{ $.Values.clustertenantManager.service.internalPort | quote }}, protocol: TCP }
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}-claimed
  namespace: {{ $pool.namespace }}
spec:
  endpointSelector:
    matchLabels:
      opencrane.ai/warm-runtime-pool: {{ include "opencrane.fullname" $ }}-{{ $pool.name }}
      opencrane.ai/warm-runtime-profile: {{ $pool.claimedProfile }}
  ingress:
    - fromEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: {{ $.Release.Namespace }}
            k8s:app.kubernetes.io/component: agent-controller
      toPorts:
        - ports:
            - { port: {{ $warm.bindingPort | quote }}, protocol: TCP }
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: {{ $.Release.Namespace }}
            k8s:app.kubernetes.io/component: opencrane-server
      toPorts:
        - ports:
            - { port: {{ $.Values.clustertenantManager.service.internalPort | quote }}, protocol: TCP }
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: {{ $.Release.Namespace }}
            k8s:app.kubernetes.io/component: litellm
      toPorts:
        - ports:
            - { port: "4000", protocol: TCP }
{{- end }}
{{- end }}
