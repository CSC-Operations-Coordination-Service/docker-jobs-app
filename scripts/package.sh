#!/usr/bin/env bash
# Build the app and package it the way Grafana installs a plugin: a zip whose
# single top-level directory is the plugin id.
#
#   VERSION=1.2.0 scripts/package.sh    -> ocs-dockerjobs-app-1.2.0.zip (+ .sha256)
#   scripts/package.sh                  -> the version in package.json
#
# The zip is what you deliver: served by the image (Dockerfile), uploaded to a
# blobstore, or unzipped into /var/lib/grafana/plugins by hand. Grafana 13.2 or
# later installs it from a URL with
#   GF_PLUGINS_PREINSTALL_SYNC=ocs-dockerjobs-app@<version>@<url>
#
# Signing: with GRAFANA_ACCESS_POLICY_TOKEN and SIGN_ROOT_URLS set, the build is
# signed as a private plugin for those Grafana root URLs. Otherwise it is
# unsigned, and Grafana must list it in
# GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=ocs-dockerjobs-app.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

PLUGIN_ID="$(node -p "require('./src/plugin.json').id")"

if [ -n "${VERSION:-}" ]; then
    # webpack writes package.json's version into plugin.json
    npm pkg set version="$VERSION"
fi
VERSION="$(node -p "require('./package.json').version")"

npm run build

if [ -n "${GRAFANA_ACCESS_POLICY_TOKEN:-}" ] && [ -n "${SIGN_ROOT_URLS:-}" ]; then
    echo "Signing $PLUGIN_ID $VERSION for $SIGN_ROOT_URLS"
    npx --yes @grafana/sign-plugin@latest --rootUrls "$SIGN_ROOT_URLS"
else
    echo "Not signing (GRAFANA_ACCESS_POLICY_TOKEN / SIGN_ROOT_URLS unset): allow it as unsigned in Grafana"
fi

ZIP="$PLUGIN_ID-$VERSION.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r dist "$STAGE/$PLUGIN_ID"
rm -f "$ZIP" "$ZIP.sha256"
(cd "$STAGE" && zip -qr "$APP_DIR/$ZIP" "$PLUGIN_ID" -x '*.map')
sha256sum "$ZIP" > "$ZIP.sha256"

echo "Packaged $ZIP"
