{{- define "opencrane.cognee.resources" -}}
{{- /* In-cluster Cognee — the graph-RAG service the opencrane-ui syncs awareness
       grants/permissions to and that tenant pods query for org context. Cognee is a
       REQUIRED service, so it is installed by default (controlPlane.cognee.install:
       true). Set that false to BYO an external/shared Cognee — the opencrane-ui then
       talks to controlPlane.cognee.endpoint and no workload is rendered here.

       The Service is named `cognee` (a cluster singleton, like ingress-nginx) so it
       matches the default endpoint `http://cognee:8000`; if you BYO, point the endpoint
       elsewhere. This `*.install` flag is deliberately separate from
       `*.backendAccessControl` (the runtime ACL-enforcement switch) so an operator can
       BYO Cognee while still enforcing the backend access control.

       SILO role (S6 / ADR 0002): every ClusterTenant gets its OWN dedicated Cognee, so
       the bundled workload IS rendered here — but the Service is release-prefixed
       (`<fullname>-cognee`, B5), so
       two silos never collide. The opencrane-ui's COGNEE_ENDPOINT is derived from this
       release-prefixed Service by the `opencrane.cogneeEndpoint` helper.

       CENTRAL role: Cognee is a per-CT plane, not a central component (ADR 0002 decision
       2), so the bundled workload is NOT rendered. */ -}}
{{- if and .Values.clustertenantManager.cognee.install }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "opencrane.fullname" . }}-cognee
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: cognee
spec:
  type: ClusterIP
  selector:
    {{- include "opencrane.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: cognee
  ports:
    - name: http
      port: {{ .Values.clustertenantManager.cognee.service.port }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "opencrane.fullname" . }}-cognee
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: cognee
spec:
  replicas: 1
  {{- if .Values.clustertenantManager.cognee.persistence.enabled }}
  # The data PVC is ReadWriteOnce — two pods can't mount it at once, so a rollout that
  # surged a second pod would deadlock (the new pod stuck Pending on the volume the old
  # pod still holds). `maxSurge: 0` tears the OLD pod down BEFORE creating the new one, so
  # the volume is free when the new pod mounts — RWO-safe, like Recreate would be.
  #
  # We deliberately do NOT use `type: Recreate`: switching an ALREADY-LIVE Deployment from
  # RollingUpdate→Recreate is rejected by the API server because the pre-existing object
  # carries an API-defaulted `strategy.rollingUpdate` block that can't coexist with
  # type:Recreate, and a Helm template `rollingUpdate: null` does NOT reliably clear a
  # field Helm never previously owned (the 3-way merge drops the null — verified live, the
  # #187/#188 failures). Keeping `type: RollingUpdate` and only tuning the params is a
  # plain in-place field update that upgrades cleanly on the live object AND on a fresh
  # install, with no strategy-type transition to migrate.
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  {{- end }}
  selector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: cognee
  template:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: cognee
      # Same convention as litellm/mcpGateway's own `podAnnotations` (values.yaml). Also doubles as
      # a sanctioned, script-driven way to force a rollout — e.g.
      # `--set clustertenantManager.cognee.podAnnotations.restartedAt=<value>` — when Cognee needs
      # to pick up a credential change (its LiteLLM key Secret is minted by the operator at
      # runtime, not Helm-templated, so `helm upgrade` has no checksum of it to trigger a natural
      # roll on its own).
      {{- with .Values.clustertenantManager.cognee.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
    spec:
      containers:
        - name: cognee
          image: "{{ .Values.clustertenantManager.cognee.image.repository }}:{{ .Values.clustertenantManager.cognee.image.tag }}"
          imagePullPolicy: {{ .Values.clustertenantManager.cognee.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.clustertenantManager.cognee.service.port }}
          env:
            - name: HOST
              value: "0.0.0.0"
            - name: PORT
              value: {{ .Values.clustertenantManager.cognee.service.port | quote }}
            {{- if .Values.clustertenantManager.cognee.persistence.enabled }}
            # Point Cognee's data + system roots at the mounted PVC so its relational/identity
            # DB, graph store, and vector store survive pod restarts. Cognee's BaseConfig is
            # pydantic-settings, so these env vars override the defaults (which live on the
            # pod's ephemeral filesystem and are WIPED on every restart — taking the operator-
            # registered per-tenant logins with them). Cache + logs stay ephemeral by design.
            - name: DATA_ROOT_DIRECTORY
              value: /cognee-data/data_storage
            - name: SYSTEM_ROOT_DIRECTORY
              value: /cognee-data/cognee_system
            {{- end }}
            {{- if .Values.litellm.enabled }}
            # Embedding + LLM (graph-extraction) provider, routed through this release's
            # LiteLLM proxy via a DEDICATED key the operator mints at boot (Secret name here
            # MUST match cognee-litellm-key.ts's COGNEE_LITELLM_KEY_SECRET_NAME literal —
            # the operator has no way to compute this chart's release-prefixed fullname).
            # `optional: true`: on first install the Secret doesn't exist yet until the
            # operator's boot-time reconcile creates it, so Cognee must start without it
            # rather than crash-loop; embedding/LLM calls fail until the key appears and this
            # pod is restarted (same bootstrap posture already accepted for tenant LiteLLM keys).
            - name: LLM_PROVIDER
              value: {{ .Values.clustertenantManager.cognee.llm.provider | quote }}
            - name: LLM_MODEL
              value: {{ .Values.clustertenantManager.cognee.llm.model | quote }}
            - name: LLM_ENDPOINT
              value: {{ include "opencrane.litellmEndpoint" . | quote }}
            - name: LLM_API_KEY
              valueFrom:
                secretKeyRef:
                  name: cognee-litellm-key
                  key: apiKey
                  optional: true
            - name: EMBEDDING_PROVIDER
              value: {{ .Values.clustertenantManager.cognee.embedding.provider | quote }}
            - name: EMBEDDING_MODEL
              value: {{ .Values.clustertenantManager.cognee.embedding.model | quote }}
            - name: EMBEDDING_DIMENSIONS
              value: {{ .Values.clustertenantManager.cognee.embedding.dimensions | quote }}
            - name: EMBEDDING_ENDPOINT
              value: {{ include "opencrane.litellmEndpoint" . | quote }}
            - name: EMBEDDING_API_KEY
              valueFrom:
                secretKeyRef:
                  name: cognee-litellm-key
                  key: apiKey
                  optional: true
            {{- end }}
          resources:
            {{- toYaml .Values.clustertenantManager.cognee.resources | nindent 12 }}
          {{- if .Values.clustertenantManager.cognee.persistence.enabled }}
          volumeMounts:
            - name: cognee-data
              mountPath: /cognee-data
          {{- end }}
      {{- if .Values.clustertenantManager.cognee.persistence.enabled }}
      volumes:
        - name: cognee-data
          persistentVolumeClaim:
            claimName: {{ include "opencrane.fullname" . }}-cognee-data
      {{- end }}
{{- if .Values.clustertenantManager.cognee.persistence.enabled }}
---
# Persistent store for Cognee's identity/relational DB + graph + vector data. Without it
# Cognee runs entirely on the pod's ephemeral filesystem, so every restart wipes the memory
# graph AND the per-tenant Cognee logins the operator registers (orphaning their cached
# Secrets → `qa store failed: 401 Unauthorized`). ReadWriteOnce, single-replica (Recreate).
# The GKE default StorageClass (pd.csi, allowVolumeExpansion) resizes online — grow by
# bumping `persistence.size` and re-deploying (grow-only; it never shrinks).
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "opencrane.fullname" . }}-cognee-data
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: cognee
spec:
  accessModes:
    - ReadWriteOnce
  {{- with .Values.clustertenantManager.cognee.persistence.storageClassName }}
  storageClassName: {{ . | quote }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.clustertenantManager.cognee.persistence.size | quote }}
{{- end }}
{{- if .Values.networkPolicy.enabled }}
---
# Defence-in-depth ingress policy for the bundled Cognee. Only the opencrane-ui
# (awareness grant / permission sync) and tenant pods (direct org-context queries via
# the Cognee memory plugin) reach it; everything else is denied at the network layer.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "opencrane.fullname" . }}-cognee-ingress
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: cognee
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: cognee
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              {{- include "opencrane.selectorLabels" . | nindent 14 }}
              app.kubernetes.io/component: opencrane-server
        - podSelector:
            matchLabels:
              app.kubernetes.io/component: tenant
      ports:
        - protocol: TCP
          port: {{ .Values.clustertenantManager.cognee.service.port }}
{{- end }}
{{- end }}
{{- end }}
