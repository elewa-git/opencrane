# The adoption gate pins this Python base by digest when the authoring image is promoted.
FROM python:3.13-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY libs/backend/agents/skills/worker/src/bootstrap.py /app/bootstrap.py

USER 65532:65532
CMD ["python", "-B", "/app/bootstrap.py"]
