# syntax=docker/dockerfile:1
#
# docker-jobs-app delivery image: nginx serving the packaged plugin zip, so the
# swarm's Grafana installs it from inside the cluster with
#   GF_PLUGINS_PREINSTALL_SYNC=ocs-dockerjobs-app@<version>@http://docker-jobs_app:8080/ocs-dockerjobs-app-<version>.zip
#
# Two stages: Node builds and packages the plugin (scripts/package.sh), nginx
# serves the zip. The zip can also be taken out of the image for a blobstore:
#   docker create --name x docker-jobs-app:<v> && docker cp x:/usr/share/nginx/html/. ./out && docker rm x
#
# Build locally (VERSION defaults to package.json's):
#   DOCKER_CONTEXT=default docker build --build-arg VERSION=0.1.0 -t docker-jobs-app:0.1.0 .
#
# In CI the npm registry is the Nexus proxy, passed as the `npmrc` secret by
# docker-build.yml's mount-npm-registry; without it npm uses the public registry.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --no-audit --no-fund

COPY . ./

# Empty = the version in package.json.
ARG VERSION=""
# Optional private signing, see scripts/package.sh.
ARG SIGN_ROOT_URLS=""
RUN --mount=type=secret,id=grafana_access_policy_token \
    set -eu; \
    if [ -s /run/secrets/grafana_access_policy_token ]; then \
        GRAFANA_ACCESS_POLICY_TOKEN="$(cat /run/secrets/grafana_access_policy_token)"; \
        export GRAFANA_ACCESS_POLICY_TOKEN; \
    fi; \
    VERSION="$VERSION" SIGN_ROOT_URLS="$SIGN_ROOT_URLS" ./scripts/package.sh


FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL Author="Serco - Space unit"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ocs-dockerjobs-app-*.zip /app/ocs-dockerjobs-app-*.zip.sha256 /usr/share/nginx/html/

# The base image runs nginx as uid 101, which cannot write the web root.
# ocs-dockerjobs-app.zip: a stable name for "whatever this image carries".
USER root
RUN set -eu; \
    cd /usr/share/nginx/html; \
    zip="$(ls ocs-dockerjobs-app-*.zip)"; \
    ln -s "$zip" ocs-dockerjobs-app.zip; \
    echo "Serving $zip"
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
