{{- define "opencrane.server.conversationComputerActivationConfig" -}}
{{- $sandbox := .Values.agentSandbox -}}
{{- if $sandbox.enabled -}}
{{- $profiles := list -}}
{{- range $profile := $sandbox.profiles -}}
{{- $profiles = append $profiles (dict "profileRevisionId" $profile.profileRevisionId "namespace" $sandbox.namespace "serviceAccountName" $sandbox.serviceAccountName "sandboxProfile" $profile.name "warmPoolName" $profile.poolName "podLabels" (dict "applicationName" (include "opencrane.name" $) "releaseName" $.Release.Name)) -}}
{{- end -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "opencrane.fullname" . }}-conversation-computer-profiles
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
immutable: true
data:
  profiles.json: {{ $profiles | toJson | quote }}
{{- end -}}
{{- end -}}
