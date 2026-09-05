FROM python:3.13.7-alpine3.22

WORKDIR /opt/opencrane
COPY apps/conversation-computer/src ./src

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENCRANE_COMPUTER_HEALTH_PORT=8080

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["python3", "-m", "src.main"]
