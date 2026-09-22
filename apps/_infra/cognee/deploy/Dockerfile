# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 cognee/cognee:1.2.1@sha256:08216665edfbfb1509f1fe866f9e3ff14c1aa930cd2d0d06e81e6549382519a1

# LadybugDB derives its extension cache from HOME. Kubernetes does not synthesize HOME when the
# image omits it, so make the build-time and pod runtime path identical. Cognee treats the
# OpenCrane LiteLLM model alias as a Hugging Face model before falling back to TikToken. Keep that
# lookup offline and bake the fallback vocabulary so startup never depends on public egress.
ENV HOME=/root \
  HF_HUB_OFFLINE=1 \
  TRANSFORMERS_OFFLINE=1 \
  TIKTOKEN_CACHE_DIR=/opt/opencrane/tiktoken-cache

ARG TARGETARCH
RUN test "${TARGETARCH:-amd64}" = "amd64" \
  && mkdir -p /root/.lbdb/extension/0.17.0/linux_amd64/json "$TIKTOKEN_CACHE_DIR" \
  && python -c 'import tiktoken; assert tiktoken.get_encoding("cl100k_base").encode("OpenCrane")'

ADD --checksum=sha256:8a5eb3c6c70cc86ea34aea777e9fc78687f69d1396055d878d2b9e0a79cb5114 \
  http://extension.ladybugdb.com/v0.17.0/linux_amd64/json/libjson.lbug_extension \
  /root/.lbdb/extension/0.17.0/linux_amd64/json/libjson.lbug_extension
