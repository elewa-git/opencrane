{{/*
Scheduled backup of the KurrentDB data volume. Included by "opencrane.kurrentdb.resources" when
historyStore.kurrentdb.backup.enabled is true.

Two modes exist because they need different cluster capabilities:
- volumeSnapshot: a Job with a small Role creates one CSI VolumeSnapshot of the data PVC. KurrentDB
  documents volume snapshots as the consistent online method (the secondary-index DuckDB files are
  captured together with the log). Requires a VolumeSnapshotClass and a kubectl image.
- fileCopy: a Job on the same node as the database copies the data files into a backup PVC in the
  order the KurrentDB backup guide prescribes (index checkpoints, index, database checkpoints,
  chunks). It needs no CSI support but KurrentDB warns that files the secondary-index engine
  modifies in place can be inconsistent while the node runs.

The deploy engine builds the restore Job from this CronJob's jobTemplate, so restore.sh ships in the
same ConfigMap and the restore needs no second image or template.
*/}}
{{- define "opencrane.kurrentdb.backup" -}}
{{- $history := .Values.historyStore.kurrentdb -}}
{{- $backup := $history.backup -}}
{{- $fullName := include "opencrane.fullname" . -}}
{{- $serviceName := printf "%s-kurrentdb" $fullName -}}
{{- $backupName := printf "%s-kurrentdb-backup" $fullName -}}
{{- $archiveClaim := printf "%s-kurrentdb-backups" $fullName -}}
{{- $dataClaim := printf "data-%s-0" $serviceName -}}
{{- if and (ne $backup.mode "fileCopy") (ne $backup.mode "volumeSnapshot") }}{{- fail "historyStore.kurrentdb.backup.mode must be fileCopy or volumeSnapshot" }}{{- end }}
{{- if eq $backup.mode "volumeSnapshot" }}
{{- if empty $backup.volumeSnapshot.className }}{{- fail "historyStore.kurrentdb.backup.volumeSnapshot.className is required in volumeSnapshot mode" }}{{- end }}
{{- if empty $backup.volumeSnapshot.image.repository }}{{- fail "historyStore.kurrentdb.backup.volumeSnapshot.image.repository is required in volumeSnapshot mode" }}{{- end }}
{{- if empty $backup.volumeSnapshot.image.digest }}{{- fail "historyStore.kurrentdb.backup.volumeSnapshot.image.digest is required in volumeSnapshot mode" }}{{- end }}
{{- if empty $backup.volumeSnapshot.kubernetesApiServerCidrs }}{{- fail "historyStore.kurrentdb.backup.volumeSnapshot.kubernetesApiServerCidrs requires the exact Kubernetes API Service address for bounded snapshot egress" }}{{- end }}
{{- if empty $backup.volumeSnapshot.kubernetesApiServerEndpointCidrs }}{{- fail "historyStore.kurrentdb.backup.volumeSnapshot.kubernetesApiServerEndpointCidrs requires exact Kubernetes API backing endpoints for bounded snapshot egress" }}{{- end }}
{{- end }}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $backupName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
automountServiceAccountToken: false
{{- if eq $backup.mode "volumeSnapshot" }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $backupName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
rules:
  # Creating, waiting on, and pruning snapshots is the only Kubernetes API the Job uses.
  - apiGroups: ["snapshot.storage.k8s.io"]
    resources: ["volumesnapshots"]
    verbs: ["get", "list", "watch", "create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $backupName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $backupName }}
subjects:
  - kind: ServiceAccount
    name: {{ $backupName }}
    namespace: {{ .Release.Namespace }}
{{- else }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ $archiveClaim }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
  annotations:
    # Helm must never delete the archive together with the release.
    helm.sh/resource-policy: keep
spec:
  accessModes: ["ReadWriteOnce"]
  {{- with $backup.archive.persistence.storageClassName }}
  storageClassName: {{ . | quote }}
  {{- end }}
  resources:
    requests:
      storage: {{ $backup.archive.persistence.size | quote }}
{{- end }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ $backupName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
data:
{{- if eq $backup.mode "volumeSnapshot" }}
  backup.sh: |
    #!/bin/sh
    set -eu
    namespace="{{ .Release.Namespace }}"
    selector="app.kubernetes.io/instance={{ .Release.Name }},app.kubernetes.io/component=kurrentdb-backup,opencrane.ai/kurrentdb-backup-kind=scheduled"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    name="{{ $serviceName }}-$stamp"
    kubectl create -f - <<EOF
    apiVersion: snapshot.storage.k8s.io/v1
    kind: VolumeSnapshot
    metadata:
      name: $name
      namespace: $namespace
      labels:
        app.kubernetes.io/instance: {{ .Release.Name }}
        app.kubernetes.io/component: kurrentdb-backup
        opencrane.ai/kurrentdb-backup-kind: scheduled
    spec:
      volumeSnapshotClassName: {{ $backup.volumeSnapshot.className }}
      source:
        persistentVolumeClaimName: {{ $dataClaim }}
    EOF
    kubectl wait --for=jsonpath='{.status.readyToUse}'=true "volumesnapshot/$name" -n "$namespace" --timeout={{ $backup.volumeSnapshot.readyTimeoutSeconds }}s
    echo "KurrentDB snapshot $name is ready to use."

    # Prune only scheduled snapshots. Pre-restore safety snapshots stay until an operator deletes them.
    kubectl get volumesnapshot -n "$namespace" -l "$selector" --sort-by=.metadata.creationTimestamp -o name > /tmp/snapshots
    total="$(wc -l < /tmp/snapshots)"
    excess="$(( total - {{ $backup.retention.keepLast }} ))"
    if [ "$excess" -gt 0 ]; then
      head -n "$excess" /tmp/snapshots | while read -r snapshot; do
        kubectl delete -n "$namespace" "$snapshot"
      done
    fi
{{- else }}
  backup.sh: |
    #!/bin/sh
    set -eu
    data=/var/lib/kurrentdb
    root=/var/lib/opencrane/kurrentdb-backups
    keep={{ $backup.retention.keepLast }}
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    target="$root/$stamp"
    work="$target.partial"

    # A crashed earlier run leaves a partial directory behind; it is never a valid restore source.
    find "$root" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -exec rm -rf {} +
    [ -f "$data/writer.chk" ] || { echo "KurrentDB data volume has no writer.chk; refusing to back up an empty or foreign volume." >&2; exit 1; }
    mkdir -p "$work"

    copy_relative() {
      mkdir -p "$work/$(dirname "$1")"
      cp -p "$data/$1" "$work/$1"
    }
    # Order from the KurrentDB backup guide: index checkpoints, the rest of the index, database
    # checkpoints, then chunks. Anything else in the data root (secondary-index files) is copied last.
    if [ -d "$data/index" ]; then
      (cd "$data" && find index -type f -name '*.chk') | while read -r file; do copy_relative "$file"; done
      (cd "$data" && find index -type f ! -name '*.chk') | while read -r file; do copy_relative "$file"; done
    fi
    (cd "$data" && find . -maxdepth 1 -type f -name '*.chk' | sed 's#^\./##') | while read -r file; do copy_relative "$file"; done
    (cd "$data" && find . -maxdepth 1 -type f -name 'chunk-*' | sed 's#^\./##') | while read -r file; do copy_relative "$file"; done
    (cd "$data" && find . -mindepth 1 -type f ! -path './index/*' ! -name '*.chk' ! -name 'chunk-*' | sed 's#^\./##') | while read -r file; do copy_relative "$file"; done

    chunks="$(find "$work" -maxdepth 1 -type f -name 'chunk-*' | wc -l | tr -d ' ')"
    files="$(find "$work" -type f | wc -l | tr -d ' ')"
    kilobytes="$(du -sk "$work" | cut -f1)"
    printf '{"backupId":"%s","mode":"fileCopy","release":"%s","takenAt":"%s","chunkFiles":%s,"files":%s,"kilobytes":%s}\n' \
      "$stamp" "{{ .Release.Name }}" "$stamp" "$chunks" "$files" "$kilobytes" > "$work/manifest.json"
    # The rename is the completion marker: restore.sh only accepts directories that carry a manifest.
    mv "$work" "$target"
    echo "KurrentDB backup $stamp complete: $chunks chunk files, $files files, ${kilobytes}K."

    # Keep the newest backups. Pre-restore safety copies share the timestamp prefix and age out too.
    find "$root" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort > /tmp/backups
    total="$(wc -l < /tmp/backups)"
    excess="$(( total - keep ))"
    if [ "$excess" -gt 0 ]; then
      head -n "$excess" /tmp/backups | while read -r old; do rm -rf "$old"; echo "Pruned $old"; done
    fi
  restore.sh: |
    #!/bin/sh
    set -eu
    data=/var/lib/kurrentdb
    root=/var/lib/opencrane/kurrentdb-backups
    id="${OPENCRANE_RESTORE_BACKUP_ID:?OPENCRANE_RESTORE_BACKUP_ID is required}"
    if [ "$id" = "latest" ]; then
      id="$(find "$root" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' ! -name '*-prerestore' -exec test -f {}/manifest.json \; -print | sort | tail -n 1 | xargs -r basename)"
      [ -n "$id" ] || { echo "No complete KurrentDB backup exists in the archive." >&2; exit 1; }
    fi
    source="$root/$id"
    [ -f "$source/manifest.json" ] || { echo "Backup '$id' is missing or incomplete (no manifest.json)." >&2; exit 1; }
    [ -f "$source/chaser.chk" ] || { echo "Backup '$id' has no chaser.chk; refusing to restore." >&2; exit 1; }
    # The deploy engine scaled KurrentDB to zero before starting this Job. A live node would still hold
    # a lock file open; refuse rather than corrupt a running database.
    if find "$data" -maxdepth 1 -type f -name '*.lock' | grep -q .; then
      echo "KurrentDB data volume still holds a lock file; is the node stopped?" >&2
      exit 1
    fi

    # Keep the current volume contents as a safety copy before anything is overwritten.
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    safety="$root/$stamp-prerestore"
    needed="$(du -sk "$data" | cut -f1)"
    available="$(df -Pk "$root" | awk 'NR==2 { print $4 }')"
    if [ "$needed" -gt "$available" ]; then
      echo "The backup volume has ${available}K free but the safety copy needs ${needed}K. Grow the archive PVC or prune old backups first." >&2
      exit 1
    fi
    mkdir -p "$safety"
    cp -a "$data/." "$safety/"
    printf '{"backupId":"%s-prerestore","mode":"fileCopy","release":"%s","takenAt":"%s","restoredFrom":"%s"}\n' "$stamp" "{{ .Release.Name }}" "$stamp" "$id" > "$safety/manifest.json"

    # Restore steps from the KurrentDB guide: copy every file, then copy chaser.chk over truncate.chk
    # so the node truncates the log to the last committed record.
    find "$data" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$source/." "$data/"
    rm -f "$data/manifest.json"
    cp -p "$data/chaser.chk" "$data/truncate.chk"
    echo "KurrentDB data volume restored from backup $id; safety copy kept at $safety."
{{- end }}
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: {{ $backupName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
  annotations:
    opencrane.ai/kurrentdb-backup-mode: {{ $backup.mode }}
spec:
  schedule: {{ $backup.schedule | quote }}
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: {{ $backup.startingDeadlineSeconds }}
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    metadata:
      labels:
        {{- include "opencrane.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: kurrentdb-backup
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: {{ $backup.activeDeadlineSeconds }}
      template:
        metadata:
          labels:
            {{- include "opencrane.selectorLabels" . | nindent 12 }}
            app.kubernetes.io/component: kurrentdb-backup
        spec:
          serviceAccountName: {{ $backupName }}
          restartPolicy: Never
          {{- if eq $backup.mode "volumeSnapshot" }}
          automountServiceAccountToken: true
          securityContext:
            runAsNonRoot: true
            runAsUser: 65532
            runAsGroup: 65532
            fsGroup: 65532
            seccompProfile:
              type: RuntimeDefault
          {{- else }}
          automountServiceAccountToken: false
          # The data PVC is ReadWriteOnce, so the copy must run on the node that already mounts it.
          affinity:
            podAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                - topologyKey: kubernetes.io/hostname
                  labelSelector:
                    matchLabels:
                      {{- include "opencrane.selectorLabels" . | nindent 22 }}
                      app.kubernetes.io/component: kurrentdb
          # Same identity as the database so its files are readable without widening their mode.
          securityContext:
            runAsNonRoot: true
            runAsUser: 1001
            runAsGroup: 1001
            fsGroup: 1001
            seccompProfile:
              type: RuntimeDefault
          {{- end }}
          containers:
            - name: backup
              {{- if eq $backup.mode "volumeSnapshot" }}
              image: "{{ $backup.volumeSnapshot.image.repository }}@{{ $backup.volumeSnapshot.image.digest }}"
              imagePullPolicy: {{ $backup.volumeSnapshot.image.pullPolicy }}
              env:
                - name: HOME
                  value: /tmp
                - name: KUBECACHEDIR
                  value: /tmp/kube-cache
              {{- else }}
              image: "{{ $history.bootstrap.image.repository }}@{{ $history.bootstrap.image.digest }}"
              imagePullPolicy: {{ $history.bootstrap.image.pullPolicy }}
              {{- end }}
              command: ["/bin/sh", "/opt/opencrane/kurrentdb-backup/backup.sh"]
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: ["ALL"]
              resources:
                {{- toYaml $backup.resources | nindent 16 }}
              volumeMounts:
                - name: backup-script
                  mountPath: /opt/opencrane/kurrentdb-backup
                  readOnly: true
                - name: scratch
                  mountPath: /tmp
                {{- if eq $backup.mode "fileCopy" }}
                - name: data
                  mountPath: /var/lib/kurrentdb
                  readOnly: true
                - name: archive
                  mountPath: /var/lib/opencrane/kurrentdb-backups
                {{- end }}
          volumes:
            - name: backup-script
              configMap:
                name: {{ $backupName }}
                defaultMode: 0550
            - name: scratch
              emptyDir:
                sizeLimit: 16Mi
            {{- if eq $backup.mode "fileCopy" }}
            - name: data
              persistentVolumeClaim:
                claimName: {{ $dataClaim }}
            - name: archive
              persistentVolumeClaim:
                claimName: {{ $archiveClaim }}
            {{- end }}
{{- if .Values.networkPolicy.enabled }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ $backupName }}
  labels:
    {{- include "opencrane.labels" . | nindent 4 }}
    app.kubernetes.io/component: kurrentdb-backup
spec:
  podSelector:
    matchLabels:
      {{- include "opencrane.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: kurrentdb-backup
  policyTypes: [Ingress, Egress]
  ingress: []
  {{- if eq $backup.mode "volumeSnapshot" }}
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # Snapshot management is the Job's only Kubernetes API use. Both the Service IP and the backing
    # endpoints are named because CNIs differ on where they enforce policy.
    - to:
        {{- range $backup.volumeSnapshot.kubernetesApiServerCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ $backup.volumeSnapshot.kubernetesApiServerPort }}
    - to:
        {{- range $backup.volumeSnapshot.kubernetesApiServerEndpointCidrs }}
        - ipBlock:
            cidr: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: {{ $backup.volumeSnapshot.kubernetesApiServerEndpointPort }}
  {{- else }}
  # The file copy talks to nobody: it reads one volume and writes another.
  egress: []
  {{- end }}
{{- end }}
{{- end }}
