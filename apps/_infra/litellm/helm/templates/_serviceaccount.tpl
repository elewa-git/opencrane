{{- define "opencrane.litellm.serviceAccount" -}}
{{- if and .Values.litellm.enabled (ne (include "opencrane.litellmShared" .) "true") }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "opencrane.fullname" . }}-litellm
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: litellm
automountServiceAccountToken: false
{{- end }}
{{- end }}
