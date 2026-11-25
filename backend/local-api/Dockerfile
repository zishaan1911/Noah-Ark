# Local SOS API (stands in for API Gateway + sos-flow). Build context: this folder; the repo is mounted at /repo.
FROM docker.io/library/python:3.12-slim
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
ENV ARK_SCHEMAS_DIR=/repo/shared/schemas
WORKDIR /repo/backend/local-api
CMD ["python", "-u", "-m", "local_api", "--broker", "broker:1883", "--port", "8080"]
