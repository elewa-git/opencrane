FROM mcr.microsoft.com/devcontainers/javascript-node:5.0.2-24-bookworm

ARG HELM_VERSION=v4.1.4
ARG HELM_SHA256_AMD64=70b2c30a19da4db264dfd68c8a3664e05093a361cefd89572ffb36f8abfa3d09
ARG HELM_SHA256_ARM64=13d03672be289045d2ff00e4e345d61de1c6f21c1257a45955a30e8ae036d8f1
ARG K3D_VERSION=v5.8.3
ARG K3D_SHA256_AMD64=dbaa79a76ace7f4ca230a1ff41dc7d8a5036a8ad0309e9c54f9bf3836dbe853e
ARG K3D_SHA256_ARM64=0b8110f2229631af7402fb828259330985918b08fefd38b7f1b788a1c8687216
ARG KUBECTL_VERSION=v1.30.10
ARG KUBECTL_SHA256_AMD64=bc74dbeefd4b9d53f03016f6778f3ffc9a72ef4ca7b7c80fd5dc1a41d52dcab7
ARG KUBECTL_SHA256_ARM64=9d65d54f02b0b305d9f3f89d19a60d3e130e09f5407df99f6d48f8c10f31e2ae
ARG TARGETARCH

RUN case "${TARGETARCH}" in \
    amd64) HELM_SHA256="${HELM_SHA256_AMD64}"; K3D_SHA256="${K3D_SHA256_AMD64}"; KUBECTL_SHA256="${KUBECTL_SHA256_AMD64}" ;; \
    arm64) HELM_SHA256="${HELM_SHA256_ARM64}"; K3D_SHA256="${K3D_SHA256_ARM64}"; KUBECTL_SHA256="${KUBECTL_SHA256_ARM64}" ;; \
    *) echo "Unsupported Tier 3 devcontainer architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl --fail --location --silent --show-error "https://get.helm.sh/helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" --output /tmp/helm.tgz \
  && echo "${HELM_SHA256}  /tmp/helm.tgz" | sha256sum --check - \
  && tar --extract --gzip --file /tmp/helm.tgz --directory /tmp \
  && install --mode 0755 "/tmp/linux-${TARGETARCH}/helm" /usr/local/bin/helm \
  && curl --fail --location --silent --show-error "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${TARGETARCH}" --output /tmp/k3d \
  && echo "${K3D_SHA256}  /tmp/k3d" | sha256sum --check - \
  && install --mode 0755 /tmp/k3d /usr/local/bin/k3d \
  && curl --fail --location --silent --show-error "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" --output /tmp/kubectl \
  && echo "${KUBECTL_SHA256}  /tmp/kubectl" | sha256sum --check - \
  && install --mode 0755 /tmp/kubectl /usr/local/bin/kubectl \
  && rm -f /tmp/helm.tgz /tmp/k3d /tmp/kubectl \
  && rm -rf "/tmp/linux-${TARGETARCH}"
