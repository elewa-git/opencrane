{{- define "opencrane.postgres.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "opencrane.postgres.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "opencrane.postgres.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "opencrane.postgres.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: opencrane
app.kubernetes.io/component: postgres
{{- end -}}

{{/* A finite cadence maps retained copies to Barman's supported recovery-window units. */}}
{{- define "opencrane.postgres.backupSchedule" -}}
{{- $schedules := dict "daily" "0 0 2 * * *" "weekly" "0 0 2 * * 1" "monthly" "0 0 2 1 * *" -}}
{{- index $schedules .Values.backup.frequency -}}
{{- end -}}

{{- define "opencrane.postgres.backupRetentionPolicy" -}}
{{- $units := dict "daily" "d" "weekly" "w" "monthly" "m" -}}
{{- printf "%d%s" (int .Values.backup.retainedCopies) (index $units .Values.backup.frequency) -}}
{{- end -}}
