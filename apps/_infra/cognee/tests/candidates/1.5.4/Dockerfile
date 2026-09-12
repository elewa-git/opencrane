# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 cognee/cognee@sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10

LABEL org.opencontainers.image.source="https://github.com/topoteretes/cognee" \
  org.opencontainers.image.version="1.5.4" \
  ai.opencrane.cognee.source-commit="20e0bd88746de2d96e99b4b122361dfc3dad21bc" \
  ai.opencrane.cognee.base-index-digest="sha256:68b755bebae2a19f482069b5efcbe8e4bdf717a68f6afb6fef80c3c352c37015" \
  ai.opencrane.cognee.base-linux-amd64-digest="sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10" \
  ai.opencrane.cognee.repair-patch-sha256="08d46750e34abdc9a0cd76d37318fa886b027ef50bb792b0f25f27f526574b50" \
  ai.opencrane.cognee.repair-postimage-sha256="3d7f8fdc029226ba33919838a522b0325e616d3c3c7820fde828f90c68c8daaf" \
  ai.opencrane.ladybug-json.sha256="39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426"

# Installing the source repair and its evidence needs build-time write access to the image.
USER root

RUN mkdir -p /opt/opencrane/cognee-repair

COPY --chmod=0644 apps/_infra/cognee/tests/candidates/1.5.4/patches/*.patch \
  /opt/opencrane/cognee-repair/
COPY --chmod=0755 \
  apps/_infra/cognee/tests/candidates/1.5.4/patches/apply-source-patch.py \
  /tmp/apply-cognee-source-patch.py

RUN package_root="$(python -c 'import cognee, pathlib; print(pathlib.Path(cognee.__file__).resolve().parent)')" && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/infrastructure/databases/relational/sqlalchemy/SqlAlchemyAdapter.py" \
    --patch /opt/opencrane/cognee-repair/sqlalchemy-delete-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/sqlalchemy-delete-recovery.json \
    --module cognee.infrastructure.databases.relational.sqlalchemy.SqlAlchemyAdapter \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 d64bd2d7214a0c69c8aa40268a0c2536d46cc54bade51b643341f82cb2f078e9 \
    --patch-sha256 08d46750e34abdc9a0cd76d37318fa886b027ef50bb792b0f25f27f526574b50 \
    --postimage-sha256 3d7f8fdc029226ba33919838a522b0325e616d3c3c7820fde828f90c68c8daaf && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/infrastructure/locks/__init__.py" \
    --patch /opt/opencrane/cognee-repair/locks-export.patch \
    --receipt /opt/opencrane/cognee-repair/locks-export.json \
    --module cognee.infrastructure.locks \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 d8bc16e31af2aa5ea8c55e688216b2fa11aa8e36270977c9c4e4821b7ebbde1d \
    --patch-sha256 0f3ecd0c126b4061bdf5efcc95b54e8ca90f6d0a887d817aa597ea77df0d9b88 \
    --postimage-sha256 5df9e8d38636ae9f0e35978b6327ce1a530d0b949f484b4c1e8dee84fbe61abc && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/infrastructure/locks/managed_data_file_lock.py" \
    --patch /opt/opencrane/cognee-repair/managed-data-file-lock.patch \
    --receipt /opt/opencrane/cognee-repair/managed-data-file-lock.json \
    --module cognee.infrastructure.locks.managed_data_file_lock \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-absent \
    --patch-sha256 91c4006d8f69584b809eb1d3351363e8634d7f5068e4dcbcdcb550916e6fc938 \
    --postimage-sha256 c3fbada36b40460f67832da43bf04b9d7e7ce2f56ed81aa01a0fc2b831fd51e7 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/run_tasks_data_item.py" \
    --patch /opt/opencrane/cognee-repair/run-tasks-data-item.patch \
    --receipt /opt/opencrane/cognee-repair/run-tasks-data-item.json \
    --module cognee.modules.pipelines.operations.run_tasks_data_item \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 bf994bdf10d4d132ea75db57bd64ea64ced0615cf0177f1e5562f5d71b199ae7 \
    --patch-sha256 7eb15e93fa0986d225ce0a3c89001f1c1b671db72c4254a690141edd4c4be312 \
    --postimage-sha256 df8872f1f864b50640f7a083e62c33d29a1c704a8f9df9918702d0b712dedc7b && \
  rm /tmp/apply-cognee-source-patch.py

USER cognee

RUN mkdir -p /app/.lbdb/extension/0.19.0/linux_amd64/json

ADD --chown=1000:1000 --chmod=0644 \
  --checksum=sha256:39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426 \
  https://extension.ladybugdb.com/v0.19.0/linux_amd64/json/libjson.lbug_extension \
  /app/.lbdb/extension/0.19.0/linux_amd64/json/libjson.lbug_extension
