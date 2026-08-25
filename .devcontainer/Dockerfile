FROM mcr.microsoft.com/devcontainers/javascript-node:5.0.2-24-bookworm

ARG HELM_VERSION=v4.1.4
ARG HELM_LINUX_AMD64_SHA256=70b2c30a19da4db264dfd68c8a3664e05093a361cefd89572ffb36f8abfa3d09
ARG K3D_VERSION=v5.8.3
ARG K3D_LINUX_AMD64_SHA256=dbaa79a76ace7f4ca230a1ff41dc7d8a5036a8ad0309e9c54f9bf3836dbe853e
ARG KUBECTL_VERSION=v1.30.10
ARG KUBECTL_LINUX_AMD64_SHA256=bc74dbeefd4b9d53f03016f6778f3ffc9a72ef4ca7b7c80fd5dc1a41d52dcab7

# Fail on another architecture because the pinned tool downloads below are linux/amd64 binaries.
RUN test "$(dpkg --print-architecture)" = "amd64" \
	&& apt-get update \
	&& apt-get install --yes --no-install-recommends ca-certificates curl jq \
	&& rm -rf /var/lib/apt/lists/*

RUN curl --location --fail --silent --show-error \
		--output /tmp/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
	&& echo "${KUBECTL_LINUX_AMD64_SHA256}  /tmp/kubectl" | sha256sum --check \
	&& install --mode 0755 /tmp/kubectl /usr/local/bin/kubectl \
	&& rm /tmp/kubectl

RUN curl --location --fail --silent --show-error \
		--output /tmp/helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
	&& echo "${HELM_LINUX_AMD64_SHA256}  /tmp/helm.tar.gz" | sha256sum --check \
	&& tar --extract --gzip --file /tmp/helm.tar.gz --directory /tmp \
	&& install --mode 0755 /tmp/linux-amd64/helm /usr/local/bin/helm \
	&& rm -rf /tmp/helm.tar.gz /tmp/linux-amd64

RUN curl --location --fail --silent --show-error \
		--output /tmp/k3d "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-amd64" \
	&& echo "${K3D_LINUX_AMD64_SHA256}  /tmp/k3d" | sha256sum --check \
	&& install --mode 0755 /tmp/k3d /usr/local/bin/k3d \
	&& rm /tmp/k3d
