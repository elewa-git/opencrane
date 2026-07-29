{{- define "opencrane.litellm.secret" -}}
{{- if and .Values.litellm.enabled (ne (include "opencrane.litellmShared" .) "true") (not .Values.litellm.existingSecret) }}
{{- $secretName := printf "%s-litellm" (include "opencrane.fullname" .) -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- $existingEncoded := "" -}}
{{- if and $existing $existing.data (hasKey $existing.data .Values.litellm.secretKey) -}}
  {{- $existingEncoded = index $existing.data .Values.litellm.secretKey -}}
{{- end -}}
{{- $configured := default "" .Values.litellm.masterKey -}}
{{- $placeholder := "change-me-in-production" -}}
{{- $generateMasterKey := true -}}
{{- if hasKey .Values.litellm "generateMasterKey" -}}
  {{- $generateMasterKey = .Values.litellm.generateMasterKey -}}
{{- end -}}
{{- $resolvedMasterKey := "" -}}
{{- if and $configured (ne $configured $placeholder) -}}
  {{- $resolvedMasterKey = $configured -}}
{{- else if $existingEncoded -}}
  {{- $resolvedMasterKey = b64dec $existingEncoded -}}
{{- else if $generateMasterKey -}}
  {{- $resolvedMasterKey = randAlphaNum 48 -}}
{{- end -}}
{{- /* LITELLM_SALT_KEY for STORE_MODEL_IN_DB: only managed here when DB model
       store is on AND no external salt secret is supplied. Reuse the persisted
       value if the Secret already exists (must be stable — rotating it makes
       DB-stored provider keys unreadable); otherwise mint one. */ -}}
{{- $manageSalt := and .Values.litellm.storeModelInDb (not .Values.litellm.existingSaltSecret) -}}
{{- $resolvedSaltKey := "" -}}
{{- if $manageSalt -}}
  {{- $configuredSalt := default "" .Values.litellm.saltKey -}}
  {{- $existingSaltEncoded := "" -}}
  {{- if and $existing $existing.data (hasKey $existing.data .Values.litellm.saltSecretKey) -}}
    {{- $existingSaltEncoded = index $existing.data .Values.litellm.saltSecretKey -}}
  {{- end -}}
  {{- if $configuredSalt -}}
    {{- $resolvedSaltKey = $configuredSalt -}}
  {{- else if $existingSaltEncoded -}}
    {{- $resolvedSaltKey = b64dec $existingSaltEncoded -}}
  {{- else -}}
    {{- $resolvedSaltKey = randAlphaNum 48 -}}
  {{- end -}}
{{- end -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ $secretName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: litellm
type: Opaque
stringData:
  {{- if $resolvedMasterKey }}
  {{ .Values.litellm.secretKey }}: {{ $resolvedMasterKey | quote }}
  {{- end }}
  {{- if $resolvedSaltKey }}
  {{ .Values.litellm.saltSecretKey }}: {{ $resolvedSaltKey | quote }}
  {{- end }}
  {{- if .Values.litellm.databaseUrl }}
  {{ .Values.litellm.databaseSecretKey }}: {{ .Values.litellm.databaseUrl | quote }}
  {{- end }}
{{- end }}
{{- end }}
