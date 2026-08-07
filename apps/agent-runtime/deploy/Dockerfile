# ADOPTION GATE (ADR 0010): pin this base image by digest (python:3.13-slim@sha256:<digest>) and
# install from the hash-pinned requirements lock before the runtime is treated as supported. The
# digest is resolved against the registry, so it is stamped by the adoption/lock step, not this
# offline slice.
FROM python:3.13-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY apps/agent-runtime/deploy/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY apps/agent-runtime/src /app/src

USER 65532:65532
CMD ["python", "-B", "-m", "src.runtime"]
