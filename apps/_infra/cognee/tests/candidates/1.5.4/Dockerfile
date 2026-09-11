# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 cognee/cognee@sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10

LABEL org.opencontainers.image.source="https://github.com/topoteretes/cognee" \
  org.opencontainers.image.version="1.5.4" \
  ai.opencrane.cognee.source-commit="20e0bd88746de2d96e99b4b122361dfc3dad21bc" \
  ai.opencrane.cognee.base-index-digest="sha256:68b755bebae2a19f482069b5efcbe8e4bdf717a68f6afb6fef80c3c352c37015" \
  ai.opencrane.cognee.base-linux-amd64-digest="sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10" \
  ai.opencrane.ladybug-json.sha256="39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426"

RUN mkdir -p /app/.lbdb/extension/0.19.0/linux_amd64/json

ADD --chown=1000:1000 --chmod=0644 \
  --checksum=sha256:39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426 \
  https://extension.ladybugdb.com/v0.19.0/linux_amd64/json/libjson.lbug_extension \
  /app/.lbdb/extension/0.19.0/linux_amd64/json/libjson.lbug_extension

USER cognee
