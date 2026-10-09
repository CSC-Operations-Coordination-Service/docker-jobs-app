# docker-jobs-app

Grafana app plugin `ocs-dockerjobs-app` ("Docker Jobs"), the UI of
[docker-jobs-backend](../docker-jobs-backend/README.md), for **Grafana 13.2** and later
(`grafanaDependency >=13.2.0`, React 19). Frontend only: every call goes through
Grafana's plugin proxy to the backend.

| Page | Role | What it does |
| --- | --- | --- |
| Jobs (default) | Viewer | every job, its schedule, next run and newest run; **Export** (the jobs file); Editors: **Run now** (the interval a date falls in -- one never run, say -- or the latest ended one, with a note), enable/disable, delete, **New job**, **Import** (a jobs file) |
| Job editor | Editor | `jobs/new`, `jobs/<name>/edit`: image, schedule, command one argument per row (with a *paste a command line* splitter that keeps `{{ ... }}` whole), env, params, retries, limits, networks, constraints, secrets, configs, mounts; **Preview** renders the command for an interval and lists the swarm objects a launch would miss |
| Runs | Viewer | newest interval first, `?job=&state=` filters, paged; expand a run for its attempts — who and why, command, exit code, node, error, **Logs** in Explore — and, for Editors, **Rerun** (an ended run) or **Cancel run** (one still going), with a note |
| Docker jobs overview | Viewer | bundled dashboard: last tick, Docker reachable, runs waiting/running, missing intervals, failed runs, data covered until, attempts by outcome, p95 duration |
| Configuration | Admin | backend URL, API token, Loki datasource |

## The jobs file

**Export** saves the definitions of every job, by name, to `docker-jobs-<YYYYMMDD-HHmm>.yaml`:
what the job editor sets, nothing the backend computes (next run, cursor, who changed it
when). **Import** reads such a file -- or one written by hand, or JSON -- so jobs can be
kept in git, reviewed, and copied from one Grafana to another:

```yaml
jobs:
  - name: collect
    image: 127.0.0.1:8085/maas-collector:3.10.1
    schedule: "0 * * * *"
    command: [maas_collector.rawdata.cli.odata, --replay-start-date, "{{ data_interval_start | iso_ms }}"]
    retries: 2
```

A field left out takes the default of a new job -- except `schedule`, which must be written,
and `start_date`, which an existing job keeps. A bare list of jobs is read too.

Before anything is written, every job of the file is checked by the backend (`POST /preview`:
the same rules as the editor) and compared with the stored one:

| In the file | Imported |
| --- | --- |
| new | created; ticked by default |
| changed | overwritten (PUT, the whole definition) if ticked; the fields that differ are listed |
| unchanged | nothing to do |
| invalid | no: the backend's reason, or a name the file holds twice |

Warnings do not stop an import: the swarm secrets, configs and networks a launch would miss,
and a new job with catch-up on and a `start_date` in the past, which runs every interval
since. The ticked jobs are saved one at a time; the result says which were created, updated,
or failed and why.

## How it reaches the backend

Four proxy routes in [src/plugin.json](src/plugin.json), all on `api/*`, templated from
the app's settings:

| Method | Role | Forwarded to |
| --- | --- | --- |
| GET | Viewer | `<backendUrl>/api/*` |
| POST, PUT, DELETE | Editor | `<backendUrl>/api/*` |

Each adds `Authorization: Bearer <apiToken>` — the backend's `API_TOKEN`, kept in the
app's `secureJsonData` — so only Grafana's proxy can call the backend. With
`GF_DATAPROXY_SEND_USER_HEADER=true` the proxy also sets `X-Grafana-User`, overwriting any
the browser sent: the backend records it on every job change, manual run, rerun and
cancel. A Viewer reads everything and gets 403 on any change; the pages hide the actions
they could not do.

The attempts' **Logs** links open Explore on the configured Loki datasource with the
attempt's `{swarm_stack, swarm_service}` selector, from a minute before its launch to a
minute after its end.

## Development

Node 22 (see `.nvmrc`). The tooling under `.config/` is `@grafana/create-plugin`'s, copied
from maas-dm-app with its lockfile.

    npm ci
    npm run dev                # rebuild dist/ on change
    npm run test:ci            # jest
    npm run typecheck && npm run lint
    DOCKER_CONTEXT=default GRAFANA_PORT=13000 docker compose up    # http://localhost:13000, admin / admin

The local Grafana mounts `dist/` and provisions the app against a backend on the host,
port 18000, with `API_TOKEN=dev-token` (see
[provisioning/plugins/apps.yaml](provisioning/plugins/apps.yaml) for the command), and a
Loki on the host, port 3100.

As in maas-dm-app, `build`/`dev` set `NODE_OPTIONS=--no-experimental-strip-types`,
`jest.config.js` transforms the ESM-only packages of the 13.2 SDK, and `jest-setup.js`
stubs `MessageChannel` (React 19) and a canvas `measureText` (`Combobox`).

## Packaging and delivery

    VERSION=0.1.0 scripts/package.sh       # -> ocs-dockerjobs-app-0.1.0.zip + .sha256

The [Dockerfile](Dockerfile) builds and packages the plugin, then serves the zip from nginx
on port 8080 (`/ocs-dockerjobs-app-<version>.zip`, `/ocs-dockerjobs-app.zip`, `/health`).
docker-jobs-backend's stack runs it as the `app` service; the Grafana that runs the app
installs it at startup with
`GF_PLUGINS_PREINSTALL_SYNC=ocs-dockerjobs-app@<version>@http://docker-jobs_app:8080/ocs-dockerjobs-app-<version>.zip`
(see that repository's `deploy/grafana/`). Unsigned by default:
`GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=ocs-dockerjobs-app`. With
`GRAFANA_ACCESS_POLICY_TOKEN` and `SIGN_ROOT_URLS`, `package.sh` signs it as a private
plugin.

CI: [.github/workflows/docker-jobs-app.yml](.github/workflows/docker-jobs-app.yml).
