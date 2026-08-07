{{- define "opencrane.server.certificate" -}}
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled .Values.certManager.enabled }}
{{- /*
Per-silo TLS certificate for the opencrane-server host.

The silo serves its control plane at the ORG host (`ingress.controlPlaneHost` =
`<cluster-tenant>.<base>`, set by the silo deploy profile). A Kubernetes Ingress can only
reference a TLS secret in its OWN namespace — so each silo must issue its own cert here, into
the secret the opencrane-server Ingress references. The Issuer it references
(`certManager.issuerName`) is normally created by THIS chart
(`certManager.selfManagedIssuer=true`), or is a separately managed namespaced Issuer when
that flag is false.
*/ -}}
{{- $host := .Values.ingress.controlPlaneHost | default (printf "platform.%s" .Values.ingress.domain) -}}
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: {{ include "opencrane.fullname" . }}-clustertenant-tls
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
spec:
  secretName: {{ required "ingress.tls.secretName is required when ingress.tls.enabled" .Values.ingress.tls.secretName }}
  issuerRef:
    name: {{ required "certManager.issuerName is required when certManager.enabled" .Values.certManager.issuerName }}
    kind: Issuer
  dnsNames:
    - {{ $host | quote }}
{{- end }}
{{- end }}
