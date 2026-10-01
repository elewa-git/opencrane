# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 ghcr.io/berriai/litellm-non_root@sha256:69db33cbce0d122f931ab98c3eb30217b434ffe982f39606e800940d7ba3f2b3

LABEL ai.opencrane.litellm.base-digest="sha256:69db33cbce0d122f931ab98c3eb30217b434ffe982f39606e800940d7ba3f2b3" \
  ai.opencrane.litellm.preforward-contract="opencrane.preforward-rate-limit.v1"

# Build-time installation needs write access; runtime retains the vendor's unprivileged user.
USER root
COPY libs/backend/server/gateways/model-routing/main/src/proxy/*.py /opt/opencrane/qualified-model-proxy/opencrane_litellm_proxy/
COPY libs/backend/server/gateways/model-routing/main/src/proxy/tests/*.py /opt/opencrane/qualified-model-proxy/opencrane_litellm_proxy/tests/
COPY --chmod=0644 apps/_infra/litellm/deploy/install-bindings.py /opt/opencrane/qualified-model-proxy/install-bindings.py
RUN python /opt/opencrane/qualified-model-proxy/install-bindings.py
ENV PYTHONPATH="/opt/opencrane/qualified-model-proxy"
USER nobody
