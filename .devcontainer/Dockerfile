FROM mcr.microsoft.com/devcontainers/javascript-node:5.0.2-24-bookworm

ARG HELM_VERSION=v4.1.4
ARG HELM_SHA256=4d71346a19a239098268882c989259bf3ea462e019086cab3393874a2f4d4bea
ARG K3D_VERSION=v5.8.3
ARG K3D_SHA256=04a247df2e0426107b7afea8445cb1e7e7211ea7721d0b47cd18552f90d1038a
ARG KUBECTL_VERSION=v1.30.10
ARG KUBECTL_SHA256=6f00944b8057e504d2a4087d2bb9f06353c1fa5c729d26ac4bb4173a348c2a60

RUN curl --fail --location --silent --show-error "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" --output /tmp/helm.tgz \
  && echo "${HELM_SHA256}  /tmp/helm.tgz" | sha256sum --check - \
  && tar --extract --gzip --file /tmp/helm.tgz --directory /tmp \
  && install --mode 0755 /tmp/linux-amd64/helm /usr/local/bin/helm \
  && curl --fail --location --silent --show-error "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-amd64" --output /tmp/k3d \
  && echo "${K3D_SHA256}  /tmp/k3d" | sha256sum --check - \
  && install --mode 0755 /tmp/k3d /usr/local/bin/k3d \
  && curl --fail --location --silent --show-error "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" --output /tmp/kubectl \
  && echo "${KUBECTL_SHA256}  /tmp/kubectl" | sha256sum --check - \
  && install --mode 0755 /tmp/kubectl /usr/local/bin/kubectl \
  && rm -rf /tmp/helm.tgz /tmp/linux-amd64 /tmp/k3d /tmp/kubectl
