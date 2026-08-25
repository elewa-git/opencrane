FROM python:3.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY apps/mcpb-validator/src/mcpb_validator.py /app/mcpb_validator.py
USER 65532:65532
CMD ["python", "-B", "/app/mcpb_validator.py"]
