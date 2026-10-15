# syntax=docker/dockerfile:1
# Build context: apps/assistant (see docker-compose.yml).

FROM python:3.14-slim AS build
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
RUN pip install --no-cache-dir uv==0.13.0
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.14-slim
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    CONTAINERIZED=true
RUN useradd --system --no-create-home assistant
COPY --from=build /opt/venv /opt/venv
USER assistant
EXPOSE 8000
CMD ["python", "-m", "assistant"]
