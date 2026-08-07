{{- define "opencrane.ui.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-ui-spa
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-ui-spa
spec:
  type: ClusterIP
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-ui-spa
  ports:
    - name: http
      port: {{ .Values.controlPlaneSpa.service.port }}
      targetPort: http
{{- end }}
