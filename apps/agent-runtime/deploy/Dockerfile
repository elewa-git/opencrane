# ADOPTION GATE (ADR 0010): pin this base image by digest (python:3.13-slim@sha256:<digest>) and
# install from the hash-pinned requirements lock before the runtime is treated as supported. The
# digest is resolved against the registry, so it is stamped by the adoption/lock step, not this
# offline slice.
FROM python:3.13-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY apps/agent-runtime/deploy/requirements.txt /app/requirements.txt
RUN pip download --no-deps --only-binary=:all: --dest /app/wheels openai==2.54.0
RUN echo "89089789197ccdb87f173a03145ed1598d00795220c93e96cf712b1cbf5e5f2b  /app/wheels/openai-2.54.0-py3-none-any.whl" | sha256sum --check --strict
RUN pip install --no-cache-dir --no-deps /app/wheels/openai-2.54.0-py3-none-any.whl
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY apps/agent-runtime/src /app/src
COPY apps/agent-runtime/qualification /app/qualification
RUN python -B -m unittest qualification.test_generated_output

USER 65532:65532
CMD ["python", "-B", "-m", "src.runtime"]
