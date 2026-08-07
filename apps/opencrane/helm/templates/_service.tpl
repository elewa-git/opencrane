{{- define "opencrane.server.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-server
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
spec:
  type: ClusterIP
  ports:
    - port: {{ .Values.clustertenantManager.service.port }}
      targetPort: http
      protocol: TCP
      name: http
    # Internal-only API listener (/api/internal/*). Reached by platform pods over the
    # cluster network (NetworkPolicy-gated); the public ingress never routes here.
    - port: {{ .Values.clustertenantManager.service.internalPort }}
      targetPort: internal
      protocol: TCP
      name: internal
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-server
{{- end }}
