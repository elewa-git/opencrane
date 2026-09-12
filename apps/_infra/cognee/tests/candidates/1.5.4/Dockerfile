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
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/data/methods/create_authorized_dataset.py" \
    --patch /opt/opencrane/cognee-repair/create-authorized-dataset-acl-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/create-authorized-dataset-acl-recovery.json \
    --module cognee.modules.data.methods.create_authorized_dataset \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 cbdf60978470b0cba30fdb53aae00f4b4657390ae37294bcc9d31460150a91c9 \
    --patch-sha256 0831738dec01b161c78f5198b1c9bc6307efa56eeb3fd82f8941be2d4de48690 \
    --postimage-sha256 a3e261dbf13831b044cbf190fb9ac204150c88afc771b761a259c2430fbdb26b && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/cognify_input_evidence.py" \
    --patch /opt/opencrane/cognee-repair/cognify-input-evidence.patch \
    --receipt /opt/opencrane/cognee-repair/cognify-input-evidence.json \
    --module cognee.modules.pipelines.operations.cognify_input_evidence \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-absent \
    --patch-sha256 0ebf313e96d2337db333817eaef1347beea99f170a9e7ae31ed9fc0118ee0f25 \
    --postimage-sha256 5b7df0e5db3f0c785b257b4ab88a6e13576287cb78f4da0072c41efeb81c6632 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/cognify_run_recovery.py" \
    --patch /opt/opencrane/cognee-repair/cognify-run-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/cognify-run-recovery.json \
    --module cognee.modules.pipelines.operations.cognify_run_recovery \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-absent \
    --patch-sha256 5b7fe3e33ff82ee67a3872ea5faec8d2424ad69cd42d656611523f7ba13bb46f \
    --postimage-sha256 2e1d1f6c54f668960f291fb77c8f35111b795b0144dfbc24d0388eff1c0a26c0 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/models/PipelineRunInfo.py" \
    --patch /opt/opencrane/cognee-repair/pipeline-run-info-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/pipeline-run-info-recovery.json \
    --module cognee.modules.pipelines.models.PipelineRunInfo \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 bb1ff28d87db42ee084bca375f0dec64042bf66ff36834a9bd3ebc64dfec63a9 \
    --patch-sha256 586ba9af1ff107a98f673414411ea1063681b65f744683da85049f5cbbe30826 \
    --postimage-sha256 562793af28ef6b18ffd191c91ef2018e960f2b373f1c0f021e78ecc880fd8859 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/utils/generate_pipeline_run_id.py" \
    --patch /opt/opencrane/cognee-repair/generate-pipeline-run-id-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/generate-pipeline-run-id-recovery.json \
    --module cognee.modules.pipelines.utils.generate_pipeline_run_id \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 45761dedbee9955aa20f0a247ba65a2b0c84d34a5c0c0f5db8b465c9982cfd38 \
    --patch-sha256 fa98f93a3a001316655b4da607457e046e853f1a2e4be10af6977672911ef7ef \
    --postimage-sha256 2b491a3895198f18797496bcff29b185431a3194ac91c62a8208632053971508 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/log_pipeline_run_start.py" \
    --patch /opt/opencrane/cognee-repair/log_pipeline_run_start-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/log_pipeline_run_start-recovery.json \
    --module cognee.modules.pipelines.operations.log_pipeline_run_start \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 befdec2bd7e6bc7c0f7102f05def09845529430bd98f9d24ea2da21bc5b96a8d \
    --patch-sha256 dbad948fe5a2b47fa7c004aa426e1eb806090549d2a918725288b65e2723aa0f \
    --postimage-sha256 848ff4b9d87d679b707c0b45967a85798914f75f3cb5bdba991a6215508556d1 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/log_pipeline_run_complete.py" \
    --patch /opt/opencrane/cognee-repair/log_pipeline_run_complete-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/log_pipeline_run_complete-recovery.json \
    --module cognee.modules.pipelines.operations.log_pipeline_run_complete \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 e8368f9f86569d0e0d79102846dd777f5678302a41357c0d9a81a74827f24892 \
    --patch-sha256 355d0fe9083bdd416d51bfe7e978f247bcc91dd56a97d4e9a7eea315cde42e0f \
    --postimage-sha256 02d8fcd96565192fd545d9004e35c86d5eb9f4dd2d64943f6c991dd1b183cc42 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/log_pipeline_run_error.py" \
    --patch /opt/opencrane/cognee-repair/log_pipeline_run_error-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/log_pipeline_run_error-recovery.json \
    --module cognee.modules.pipelines.operations.log_pipeline_run_error \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 352d8ffdbab00b81768dcf5f4b0155d59be925816a921d7e1ea5cb93c5816210 \
    --patch-sha256 0efefeca72028ec862c8af5b2f99202f0eaf56e4f688ba179297ee3efd63059d \
    --postimage-sha256 490ffd6c0bd1b39f4a0dc75b31ed00493f6a503daa1d0888be72d179f26025cf && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/pipeline.py" \
    --patch /opt/opencrane/cognee-repair/pipeline-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/pipeline-recovery.json \
    --module cognee.modules.pipelines.operations.pipeline \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 60851f717ecd0b4c14fa6a7b1caac2cb4a98a52ca9c76e395601bbeeed69d667 \
    --patch-sha256 182d580032e9853b4db302380cdf7b7e4ef877fbbce910f33da9fa24bf9c1756 \
    --postimage-sha256 60008785c69f72471469843c7dc5da3c2df7573a55a7a68724e6748cc33dfe4c && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/modules/pipelines/operations/run_tasks.py" \
    --patch /opt/opencrane/cognee-repair/run_tasks-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/run_tasks-recovery.json \
    --module cognee.modules.pipelines.operations.run_tasks \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 adcc62df702d4c8163e43cd7f824b63e0889bcc4c90ee4779013dcddf33a1370 \
    --patch-sha256 10f8123c0799b7e961b300dfbb7cab0255c82f40dbf2a977540b8406ba8897c1 \
    --postimage-sha256 1df56f0ffbaeff6e9a2a0aeaa2474cc662b8f6d735a8695bc0427fb3e2aea2b7 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/api/v1/cognify/cognify.py" \
    --patch /opt/opencrane/cognee-repair/cognify-operation-flow.patch \
    --receipt /opt/opencrane/cognee-repair/cognify-operation-flow.json \
    --module cognee.api.v1.cognify.cognify \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 9305160366736380639f9781c917c501bfb45f766fac79a0c0865c699ba01d00 \
    --patch-sha256 4ba59030198e0f5794d14a43a05b9e5f50cbb72b263923e99afe41e5fb30d248 \
    --postimage-sha256 c65b713d425db4b1b4d55e739499b5489bf44e1cc9a99fa609c43db28d4fadd6 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/api/v1/cognify/routers/get_cognify_router.py" \
    --patch /opt/opencrane/cognee-repair/cognify-router-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/cognify-router-recovery.json \
    --module cognee.api.v1.cognify.routers.get_cognify_router \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 3632b88864dc39ef1c719b8fe7914f897939e7d3622756f0d0ba9a922b322b63 \
    --patch-sha256 8cbe53f5030173700154caf8f63c7929ef15acef79db09c0a0653220fea36266 \
    --postimage-sha256 c7e7cbe1d0faaa20bb26dc2a763016db32644d5b7e590cd1ccaa4941e328858b && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/api/v1/datasets/dto.py" \
    --patch /opt/opencrane/cognee-repair/dataset-evidence-dto.patch \
    --receipt /opt/opencrane/cognee-repair/dataset-evidence-dto.json \
    --module cognee.api.v1.datasets.dto \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 9864c4d4cffd5e5c45ef6b9b18daa8e861a5c73f25b88caf16468d1d4b7cd68c \
    --patch-sha256 19eb21e204a485c2068325205d81228ce3a1f8d23752529789382c0906fcc860 \
    --postimage-sha256 3348738cdadd0372e6063fc62fd609c89a99ec1489dc79f387394c12ba0d0fb2 && \
  python /tmp/apply-cognee-source-patch.py \
    --source "$package_root/api/v1/datasets/routers/get_datasets_router.py" \
    --patch /opt/opencrane/cognee-repair/dataset-route-acl-recovery.patch \
    --receipt /opt/opencrane/cognee-repair/dataset-route-acl-recovery.json \
    --module cognee.api.v1.datasets.routers.get_datasets_router \
    --base-image-digest sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10 \
    --preimage-sha256 87b3ff9da756bbf730237197cdedcd26278f27e0c17f19ae887b77c9c0ccc241 \
    --patch-sha256 b4ce55d9d619c0be85417956f85bdc82a729359acfddee130675d8a695fee35c \
    --postimage-sha256 677afc0b7bb6c2633cf2c01d59a18f72dee0a2131ea6f49b16a42c72420baafb && \
  rm /tmp/apply-cognee-source-patch.py


USER cognee

RUN mkdir -p /app/.lbdb/extension/0.19.0/linux_amd64/json

ADD --chown=1000:1000 --chmod=0644 \
  --checksum=sha256:39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426 \
  https://extension.ladybugdb.com/v0.19.0/linux_amd64/json/libjson.lbug_extension \
  /app/.lbdb/extension/0.19.0/linux_amd64/json/libjson.lbug_extension
