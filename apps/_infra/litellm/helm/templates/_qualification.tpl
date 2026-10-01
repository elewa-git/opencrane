{{/* Return the existing image by tag, or a published image selected by digest. */}}
{{- define "opencrane.litellm.image" -}}
{{- $digest := default "" .Values.litellm.image.digest -}}
{{- if $digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) -}}
{{- fail "litellm.image.digest must be a SHA-256 image digest" -}}
{{- end -}}
{{- printf "%s@%s" .Values.litellm.image.repository $digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.litellm.image.repository .Values.litellm.image.tag -}}
{{- end -}}
{{- end -}}

{{/* A retry proof is accepted only from a qualified, release-local owned image. */}}
{{- define "opencrane.litellm.preforward" -}}
{{- $contract := default "" .Values.litellm.preforwardRejectionContract -}}
{{- if $contract -}}
{{- if ne $contract "opencrane.preforward-rate-limit.v1" -}}
{{- fail "litellm.preforwardRejectionContract is not a supported contract" -}}
{{- end -}}
{{- if or (not .Values.litellm.enabled) (eq (include "opencrane.litellmShared" .) "true") -}}
{{- fail "litellm.preforwardRejectionContract requires managed release-local LiteLLM" -}}
{{- end -}}
{{- if ne .Values.litellm.image.repository "ghcr.io/elewa-git/opencrane-litellm" -}}
{{- fail "litellm.preforwardRejectionContract requires the OpenCrane-owned LiteLLM image" -}}
{{- end -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" (default "" .Values.litellm.image.digest)) -}}
{{- fail "litellm.preforwardRejectionContract requires a qualified published image digest" -}}
{{- end -}}
{{- dict "origin" (include "opencrane.litellmEndpoint" .) "contract" $contract | toJson -}}
{{- else -}}
{}
{{- end -}}
{{- end -}}
