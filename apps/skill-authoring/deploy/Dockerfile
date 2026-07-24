# The lockfile makes the validator toolchain reproducible; this stage performs the only package install.
FROM python:3.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0 AS validator-tools

COPY apps/skill-authoring/deploy/validator.requirements.txt /tmp/validator.requirements.txt
RUN python -m pip install --no-cache-dir --require-hashes --prefix=/opt/opencrane -r /tmp/validator.requirements.txt

# The official non-_base image carries ClamAV 1.5.2 with its signature database already installed.
FROM clamav/clamav:1.5.2@sha256:1b6443c4a7b456baa1abfaf9796815f8d21e2fb558dbaed5b682fd4552d8b0c3

WORKDIR /app
ENV PATH=/opt/opencrane/bin:/usr/local/bin:/usr/bin:/bin
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/opt/opencrane/lib/python3.13/site-packages
COPY --from=validator-tools /usr/local /usr/local
COPY --from=validator-tools /opt/opencrane /opt/opencrane
COPY libs/backend/agents/skills/worker/src/bootstrap.py /app/bootstrap.py
COPY apps/skill-authoring/src/authoring_worker.py /app/authoring_worker.py
RUN mkdir -p /opt/opencrane/clamav-db /opt/opencrane/bin \
    && cp -a /var/lib/clamav/. /opt/opencrane/clamav-db/ \
    && ln -s /usr/bin/clamscan /opt/opencrane/bin/clamscan \
    && chmod -R a-w /opt/opencrane/clamav-db

# The upstream image starts freshclam/clamd by default. This one-shot Job must never update or listen.
ENTRYPOINT []
USER 65532:65532
# The controller has no authoring image digest until this immutable image is published and promoted.
CMD ["python", "-B", "/app/authoring_worker.py"]
