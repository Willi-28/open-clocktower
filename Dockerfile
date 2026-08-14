FROM node:22-alpine AS frontend
WORKDIR /app/apps/frontend

# Install frontend dependencies from the lockfile for reproducible builds.
# --include=dev is explicit: vite/typescript are build-only, so the build must
# not depend on NODE_ENV happening to be unset in the base image.
COPY apps/frontend/package*.json ./
RUN npm ci --include=dev
COPY apps/frontend ./
RUN npm run build

FROM python:3.12-alpine AS backend
WORKDIR /app

# Keep container logs immediate and avoid writing Python cache files.
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

# Install the FastAPI backend, then copy the built frontend into the static folder.
# pip/setuptools/wheel are build-time only; remove all three in the same layer so
# pip's vendored SBOM does not remain in the runtime image and trigger scanner
# findings for packages the server never imports.
COPY apps/backend ./apps/backend
RUN python -m pip install --upgrade pip "setuptools>=83.0.0" wheel \
    && pip install --no-cache-dir -e ./apps/backend \
    && python -m pip uninstall -y setuptools wheel pip
COPY --from=frontend /app/apps/frontend/dist ./apps/backend/app/static

ENV APP_HOST=0.0.0.0
ENV APP_PORT=8000

# Which peers may set X-Forwarded-For/-Proto. Uvicorn reads this variable itself
# and defaults to 127.0.0.1, so a directly exposed container trusts nobody. A
# reverse-proxy deployment sets the proxy's network (see docker-compose.prod.yml).
# Never "*": uvicorn then takes the FIRST X-Forwarded-For entry from any caller,
# making the client IP behind the per-IP rate limits attacker-controlled.
ENV FORWARDED_ALLOW_IPS=127.0.0.1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
