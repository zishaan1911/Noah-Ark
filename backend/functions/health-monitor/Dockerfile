# health-monitor local runner (stands in for the IoT rule + Lambda). Build context: this folder; the repo is mounted at /repo.
FROM python:3.12-slim
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /repo/backend/functions/health-monitor
