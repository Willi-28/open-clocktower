FROM node:22-alpine AS frontend
WORKDIR /app/apps/frontend

# Same reason as the backend stage: never inherit an unpatched cached base.
RUN apk upgrade --no-cache

# Install frontend dependencies from the lockfile for reproducible builds.
# --include=dev is explicit: vite/typescript are build-only, so the build must
# not depend on NODE_ENV happening to be unset in the base image.
COPY apps/frontend/package*.json ./
RUN npm ci --include=dev
COPY apps/frontend ./
# Character packs are private local build inputs. Fail closed if an ignore rule
# is ever removed or changed instead of publishing a pack in a Docker layer.
RUN ! find src/packs -type f -iname '*.zip' -print -quit | grep -q .
RUN npm run build

FROM python:3.12-alpine AS backend
WORKDIR /app

# Patch the base image's OS packages before anything else.
#
# A build that reuses a cached "python:3.12-alpine" layer inherits whatever that
# layer shipped: an audit of this image found 9 openssl advisories, two of them
# critical, purely because the cached base was stale - the freshly pulled tag was
# clean. Upgrading here means the image is patched even when the cache is old or
# the tag has not been rebuilt yet. Build with --pull as well; this is the belt
# to that suspenders.
RUN apk upgrade --no-cache

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

# Drop root. The server never writes to disk - avatars and character packs live
# in PostgreSQL as data URLs, and DATA_DIR/UPLOAD_DIR are unused settings - so it
# needs nothing beyond read access to its own files. Running as root would hand
# an application-level flaw or a container escape full privileges for no benefit.
# The image is therefore also safe to run with `read_only: true`.
RUN addgroup -S app && adduser -S -G app -H -s /sbin/nologin app
USER app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
