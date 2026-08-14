# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 cognee/cognee:1.2.1@sha256:08216665edfbfb1509f1fe866f9e3ff14c1aa930cd2d0d06e81e6549382519a1

# LadybugDB derives its extension cache from HOME. Kubernetes does not synthesize HOME when the
# image omits it, so make the build-time and pod runtime path identical.
ENV HOME=/root

ARG TARGETARCH
RUN test "${TARGETARCH:-amd64}" = "amd64" \
  && mkdir -p /root/.lbdb/extension/0.17.0/linux_amd64/json

ADD --checksum=sha256:8a5eb3c6c70cc86ea34aea777e9fc78687f69d1396055d878d2b9e0a79cb5114 \
  http://extension.ladybugdb.com/v0.17.0/linux_amd64/json/libjson.lbug_extension \
  /root/.lbdb/extension/0.17.0/linux_amd64/json/libjson.lbug_extension
