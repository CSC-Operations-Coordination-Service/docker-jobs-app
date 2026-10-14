# syntax=docker/dockerfile:1
#
# docker-jobs-app delivery image: nginx serving the packaged plugin zip, so the
# swarm's Grafana installs it from inside the cluster with
#   GF_PLUGINS_PREINSTALL_SYNC=ocs-dockerjobs-app@<version>@http://docker-jobs_app:8080/ocs-dockerjobs-app-<version>.zip
#
# The plugin zip is built OUTSIDE the image, by scripts/package.sh: in CI by
# the `package` job (its artifact is downloaded into release/), locally by
# hand. BuildKit RUN steps on the CI runner have no internet access, so the
# image build only copies files (2026-10-14: apt-get and npm ci failed there).
# The zip can also be taken out of the image for a blobstore:
#   docker create --name x docker-jobs-app:<v> && docker cp x:/usr/share/nginx/html/. ./out && docker rm x
#
# Build locally (VERSION defaults to package.json's):
#   ./scripts/package.sh && mkdir -p release && mv ocs-dockerjobs-app-*.zip* release/
#   DOCKER_CONTEXT=default docker build -t docker-jobs-app:0.1.0 .
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL Author="Serco - Space unit"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY release/ocs-dockerjobs-app-*.zip release/ocs-dockerjobs-app-*.zip.sha256 /usr/share/nginx/html/

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
