FROM python:3.13.7-alpine3.22

RUN apk add --no-cache chromium=142.0.7444.59-r0 git nodejs npm \
    && mkdir -p /workspace \
    && chown 65532:65532 /workspace

WORKDIR /opt/opencrane
COPY apps/conversation-computer/src ./src

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENCRANE_COMPUTER_HEALTH_PORT=8080 \
    OPENCRANE_WORKSPACE_PATH=/workspace

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["python3", "-m", "src.main"]
