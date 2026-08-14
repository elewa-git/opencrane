{{- define "opencrane.ui.deployment" -}}
{{- $image := printf "%s:%s" .Values.controlPlaneSpa.image.repository .Values.controlPlaneSpa.image.tag -}}
{{- if .Values.controlPlaneSpa.image.digest -}}
{{- $image = printf "%s@%s" .Values.controlPlaneSpa.image.repository .Values.controlPlaneSpa.image.digest -}}
{{- end -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-opencrane-ui-spa
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: opencrane-ui-spa
spec:
  replicas: {{ .Values.controlPlaneSpa.replicas }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: opencrane-ui-spa
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: opencrane-ui-spa
    spec:
      securityContext:
        {{- toYaml .Values.controlPlaneSpa.podSecurityContext | nindent 8 }}
      containers:
        - name: opencrane-ui-spa
          image: "{{ $image }}"
          imagePullPolicy: {{ .Values.controlPlaneSpa.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.controlPlaneSpa.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: {{ .Values.controlPlaneSpa.service.port }}
          # Static SPA bundle — no app env, no DB, no upstream API calls (nginx never
          # proxy_passes; /api + /gateway are routed by the ingress, not this container).
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
          resources:
            {{- toYaml .Values.controlPlaneSpa.resources | nindent 12 }}
{{- end }}
