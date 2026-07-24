{{- define "opencrane.agentController.skillWorkloadAdmission" -}}
{{- $controllerName := "agent-controller" -}}
{{- $authoringNamespace := (index .Values "opencrane-skill-authoring").skillAuthoring.namespace -}}
{{- $toolRunnerNamespace := (index .Values "opencrane-tool-runner").toolRunner.namespace -}}
{{- $authoringImage := printf "%s@%s" .Values.agentController.skillWorkloadProfiles.authoring.image.repository .Values.agentController.skillWorkloadProfiles.authoring.image.digest -}}
{{- $toolRunnerImage := printf "%s@%s" .Values.agentController.skillWorkloadProfiles.toolRunner.image.repository .Values.agentController.skillWorkloadProfiles.toolRunner.image.digest -}}
{{- $skillBootstrapUrl := printf "http://%s-opencrane-server.%s.svc.cluster.local:%v/api/internal/agent-runtime" (include "opencrane.fullname" .) .Release.Namespace .Values.clustertenantManager.service.internalPort -}}
{{- $controllerUsername := printf "system:serviceaccount:%s:%s" .Release.Namespace $controllerName -}}
{{- $suffix := printf "%s/%s" .Release.Namespace .Release.Name | sha256sum | trunc 10 -}}
{{- $policyName := printf "%s-skill-workloads-%s" (include "opencrane.fullname" .) $suffix | trunc 63 | trimSuffix "-" -}}
# Governs only the two isolated skill-worker namespaces. The controller may create the fixed Job
# shape suspended, then make exactly one immutable-template-preserving suspend=false transition.
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: {{ $policyName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: governed-skill-workload
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
  matchConditions:
    - name: governed-skill-namespaces
      expression: request.namespace == {{ $authoringNamespace | toJson }} || request.namespace == {{ $toolRunnerNamespace | toJson }}
  validations:
    - expression: request.userInfo.username == {{ $controllerUsername | toJson }}
      message: only this release's controller ServiceAccount may create or release governed skill Jobs
    - expression: >-
        request.operation == 'UPDATE' ||
        ((object.metadata.namespace == {{ $authoringNamespace | toJson }} &&
          object.metadata.name.matches('^skill-author-[a-f0-9]{24}$') &&
          object.metadata.labels.size() == 3 &&
          object.metadata.labels['app.kubernetes.io/name'] == 'opencrane-skill-authoring' &&
          object.metadata.labels['app.kubernetes.io/component'] == 'skill-authoring' &&
          object.metadata.labels['opencrane.ai/skill-workload'] == object.metadata.name &&
          object.metadata.annotations.size() == 3 &&
          object.spec.template.spec.serviceAccountName == 'skill-authoring-default' &&
          object.spec.template.spec.containers[0].name == 'skill-authoring' &&
          object.spec.template.spec.containers[0].image == {{ $authoringImage | toJson }} &&
          object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-skill-authoring') ||
         (object.metadata.namespace == {{ $toolRunnerNamespace | toJson }} &&
          object.metadata.name.matches('^tool-run-[a-f0-9]{24}$') &&
          object.metadata.labels.size() == 3 &&
          object.metadata.labels['app.kubernetes.io/name'] == 'opencrane-tool-runner' &&
          object.metadata.labels['app.kubernetes.io/component'] == 'tool-runner' &&
          object.metadata.labels['opencrane.ai/skill-workload'] == object.metadata.name &&
          object.metadata.annotations.size() == 3 &&
          object.spec.template.spec.serviceAccountName == 'tool-runner-default' &&
          object.spec.template.spec.containers[0].name == 'tool-runner' &&
          object.spec.template.spec.containers[0].image == {{ $toolRunnerImage | toJson }} &&
          object.spec.template.spec.volumes[0].projected.sources[0].serviceAccountToken.audience == 'opencrane-tool-runner'))
      message: governed skill Job identity, class identity, image, and capability-token audience must be fixed
    - expression: >-
        request.operation == 'UPDATE' ||
        (object.spec.suspend == true && object.spec.parallelism == 1 && object.spec.completions == 1 &&
         object.spec.backoffLimit == 0 && object.spec.ttlSecondsAfterFinished == 0 &&
         object.spec.activeDeadlineSeconds > 0 && object.spec.activeDeadlineSeconds <= 900 &&
         object.spec.template.spec.automountServiceAccountToken == false &&
         object.spec.template.spec.enableServiceLinks == false && object.spec.template.spec.restartPolicy == 'Never' &&
         object.spec.template.spec.securityContext.runAsNonRoot == true &&
         object.spec.template.spec.securityContext.runAsUser == 65532 &&
         object.spec.template.spec.securityContext.runAsGroup == 65532 &&
         object.spec.template.spec.securityContext.fsGroup == 65532 &&
         object.spec.template.spec.securityContext.seccompProfile.type == 'RuntimeDefault' &&
         (!has(object.spec.template.spec.initContainers) || object.spec.template.spec.initContainers.size() == 0) &&
         (!has(object.spec.template.spec.hostNetwork) || object.spec.template.spec.hostNetwork == false) &&
         (!has(object.spec.template.spec.hostPID) || object.spec.template.spec.hostPID == false) &&
         (!has(object.spec.template.spec.hostIPC) || object.spec.template.spec.hostIPC == false) &&
         object.spec.template.spec.containers.size() == 1 &&
         object.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation == false &&
         (!has(object.spec.template.spec.containers[0].securityContext.privileged) || object.spec.template.spec.containers[0].securityContext.privileged == false) &&
         object.spec.template.spec.containers[0].securityContext.capabilities.drop.size() == 1 &&
         object.spec.template.spec.containers[0].securityContext.capabilities.drop[0] == 'ALL' &&
         (!has(object.spec.template.spec.containers[0].securityContext.capabilities.add) || object.spec.template.spec.containers[0].securityContext.capabilities.add.size() == 0) &&
         object.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem == true &&
         ((object.metadata.namespace == {{ $authoringNamespace | toJson }} &&
           quantity(object.spec.template.spec.containers[0].resources.requests.cpu).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.authoring.resources.requests.cpu | toJson }})) == 0 &&
           quantity(object.spec.template.spec.containers[0].resources.requests.memory).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.authoring.resources.requests.memory | toJson }})) == 0 &&
           quantity(object.spec.template.spec.containers[0].resources.limits.cpu).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.authoring.resources.limits.cpu | toJson }})) == 0 &&
           quantity(object.spec.template.spec.containers[0].resources.limits.memory).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.authoring.resources.limits.memory | toJson }})) == 0) ||
          (object.metadata.namespace == {{ $toolRunnerNamespace | toJson }} &&
           quantity(object.spec.template.spec.containers[0].resources.requests.cpu).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.toolRunner.resources.requests.cpu | toJson }})) == 0 &&
           quantity(object.spec.template.spec.containers[0].resources.requests.memory).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.toolRunner.resources.requests.memory | toJson }})) == 0 &&
           quantity(object.spec.template.spec.containers[0].resources.limits.cpu).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.toolRunner.resources.limits.cpu | toJson }})) == 0 &&
           quantity(object.spec.template.spec.containers[0].resources.limits.memory).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.toolRunner.resources.limits.memory | toJson }})) == 0)) &&
         (!has(object.spec.template.spec.containers[0].command) || object.spec.template.spec.containers[0].command.size() == 0) &&
         (!has(object.spec.template.spec.containers[0].args) || object.spec.template.spec.containers[0].args.size() == 0) &&
         object.spec.template.spec.containers[0].env.size() == 3 &&
         object.spec.template.spec.containers[0].env[0].name == 'OPENCRANE_SKILL_BOOTSTRAP_URL' &&
         object.spec.template.spec.containers[0].env[0].value == {{ $skillBootstrapUrl | toJson }} &&
         object.spec.template.spec.containers[0].env[1].name == 'OPENCRANE_SKILL_TOKEN_PATH' &&
         object.spec.template.spec.containers[0].env[1].value == '/var/run/opencrane/tokens/capability.token' &&
         object.spec.template.spec.containers[0].env[2].name == 'OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH' &&
         object.spec.template.spec.containers[0].env[2].value == '/var/run/opencrane/bootstrap/reference' &&
         object.spec.template.spec.volumes.size() == 3 && object.spec.template.spec.volumes[0].name == 'capability-token' &&
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
         has(object.spec.template.spec.volumes[2].emptyDir) && !has(object.spec.template.spec.volumes[2].hostPath) &&
         ((object.metadata.namespace == {{ $authoringNamespace | toJson }} && quantity(object.spec.template.spec.volumes[2].emptyDir.sizeLimit).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.authoring.scratchSize | toJson }})) == 0) ||
          (object.metadata.namespace == {{ $toolRunnerNamespace | toJson }} && quantity(object.spec.template.spec.volumes[2].emptyDir.sizeLimit).compareTo(quantity({{ .Values.agentController.skillWorkloadProfiles.toolRunner.scratchSize | toJson }})) == 0)) &&
         object.spec.template.spec.containers[0].volumeMounts.size() == 3 &&
         object.spec.template.spec.containers[0].volumeMounts[0].name == 'capability-token' &&
         object.spec.template.spec.containers[0].volumeMounts[0].mountPath == '/var/run/opencrane/tokens' &&
         object.spec.template.spec.containers[0].volumeMounts[0].readOnly == true &&
         object.spec.template.spec.containers[0].volumeMounts[1].name == 'bootstrap-reference' &&
         object.spec.template.spec.containers[0].volumeMounts[1].mountPath == '/var/run/opencrane/bootstrap' &&
         object.spec.template.spec.containers[0].volumeMounts[1].readOnly == true &&
         object.spec.template.spec.containers[0].volumeMounts[2].name == 'scratch' &&
         object.spec.template.spec.containers[0].volumeMounts[2].mountPath == '/tmp')
      message: governed skill Job execution, token projection, Pod identity, and scratch shape must be fixed
    - expression: >-
        request.operation == 'CREATE' ||
        (oldObject.spec.suspend == true && object.spec.suspend == false &&
         object.metadata.name == oldObject.metadata.name && object.metadata.labels == oldObject.metadata.labels &&
         object.metadata.annotations == oldObject.metadata.annotations && object.spec.parallelism == oldObject.spec.parallelism &&
         object.spec.completions == oldObject.spec.completions && object.spec.backoffLimit == oldObject.spec.backoffLimit &&
         object.spec.activeDeadlineSeconds > 0 && object.spec.activeDeadlineSeconds <= oldObject.spec.activeDeadlineSeconds &&
         object.spec.ttlSecondsAfterFinished == oldObject.spec.ttlSecondsAfterFinished && object.spec.template == oldObject.spec.template)
      message: a governed skill Job update may only release the exact stored suspended Job once
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: {{ $policyName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: governed-skill-workload
spec:
  policyName: {{ $policyName }}
  validationActions: [Deny]
{{- end }}
