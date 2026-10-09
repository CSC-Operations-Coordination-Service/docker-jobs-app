# docker-jobs-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Grafana app plugin `ocs-dockerjobs-app`: the UI of docker-jobs-backend. In it, people can:
- list jobs with their newest run and run them now;
- create, edit, enable, disable and delete jobs, with a preview of the rendered command;
- browse runs and their attempts, open an attempt's logs in Loki, and rerun or cancel a run;
- see a bundled metrics overview.

**Architecture:**
- A frontend-only app plugin (React 19, Grafana 13.2), built with maas-dm-app's toolchain, which is copied as-is.
- Every call goes through Grafana's plugin proxy. The routes in plugin.json forward `api/*` to the configured backend URL: GET for Viewers; POST, PUT and DELETE for Editors. Each request carries the backend's API token from `secureJsonData`, and Grafana sets `X-Grafana-User`.
- Delivery mirrors maas-dm-app: an nginx image serves the plugin zip, which Grafana installs at startup. That image becomes an `app` service in docker-jobs-backend's stack.

**Tech Stack:** TypeScript, React 19.2, `@grafana/data`/`ui`/`runtime` ~13.2.3, react-router-dom 6, Jest with Testing Library, webpack (`@grafana/create-plugin` 5.19.1 `.config/`), nginx-unprivileged, the workflow-catalog `node-workflow.yml` and `docker-build.yml`.

**Spec:** There is no separate spec. The requirements are the user's request of 2026-10-09: "a frontend … a grafana app located at ../docker-jobs-app", able to "manually rerun a task (failed or succeeded)" and to detect missing or failed runs. Four decisions were taken while planning this app:
- the plugin id is `ocs-dockerjobs-app`;
- it ships a bundled overview dashboard;
- its delivery image is a service of the docker-jobs stack;
- commands are edited one argument per row, with a paste helper.

The contract is docker-jobs-backend's API on `develop` (`src/docker_jobs_backend/schemas.py`, `jobs.py`, `runs.py`, and its README's API table) and its metrics (`telemetry.py`). Its plan is `../docker-jobs-backend/docs/superpowers/plans/2026-10-09-docker-jobs-backend.md`.

> All code in this plan was prototyped against a clean `npm ci` of this lockfile. It passed `typecheck`, `lint` (0 warnings), `test:ci` (51 tests), `build` and `scripts/package.sh`. The delivery image built and served the zip. In a Grafana 13.2.0 container, the proxy routes were exercised against the real backend: the token was forwarded, the user was recorded, a Viewer got 403 on writes, and the dashboard was auto-imported.

## Global Constraints

- **Plugin:** id `ocs-dockerjobs-app`, name `Docker Jobs`, `"backend": false`, `grafanaDependency` `>=13.2.0`.
- **Toolchain:** copied from `../download-manager/maas-dm-app`, never re-scaffolded:
  - `.config/` (`@grafana/create-plugin` 5.19.1, scaffold-owned, not edited);
  - the same `package.json` dependencies and `package-lock.json`, with only the package name changed;
  - Node 22 (`.nvmrc`) and npm.
- **Backend calls:** all of them go through the plugin proxy (`API_BASE = /api/plugin-proxy/ocs-dockerjobs-app/api/v1`). There are four routes on `api/*`:
  - GET, `reqRole` Viewer;
  - POST, PUT and DELETE, `reqRole` Editor;
  - every route adds the header `Authorization: Bearer {{ .SecureJsonData.apiToken }}`.
- **App settings:** `jsonData` holds `backendUrl` and `lokiDatasourceUid`; `secureJsonData` holds `apiToken`.
- **Pages:** Jobs (default) and Runs for Viewers. The job editor, Run now, enable/disable, delete, rerun and cancel are shown only to Editors and Admins (`canEdit()`).
- **Times:** shown in UTC as `YYYY-MM-DD HH:mm:ss`, and intervals as `YYYY-MM-DD HH:mm → HH:mm`. Dates are sent as the ISO strings the user typed, with a timezone.
- **Every task ends green:** `npm run typecheck`, `npm run lint` (0 problems), `npm run test:ci` and `npm run build` all pass.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

These are the inputs and failure modes most likely to hurt someone using the app. Each one has its test in the task that owns the code.

1. **A Viewer must not be shown Editor actions.** Clicking them would only give a 403. Viewers see the jobs, the runs and the Runs links, and no Run now, Disable, Delete, New job, Rerun or Cancel. *Task 4:* `shows a Viewer the jobs and their runs, no actions`. *Task 6:* `offers a Viewer neither rerun nor cancel`.
2. **The backend refuses a definition (422 with pydantic's detail list).** The message names the field, and the form keeps what was typed. *Task 2:* `shows where each validation error is`. *Task 5:* `keeps the form as typed and says what the backend refused`.
3. **A pasted command line contains templates with spaces** (`--start {{ data_interval_start | iso_ms }}`). Each template stays one argument, and an unclosed quote says so rather than splitting wrong. *Task 2:* `never splits a template, spaces and all`. *Task 3:* `splits a pasted command line into one row per argument` and `says what is wrong with a line it cannot split`.
4. **The backend is unreachable, misrouted, or not configured.** The page says why: the route error, or "not configured". It is never blank. *Task 1:* `asks for the backend URL before anything else`. *Task 4:* `says why the jobs cannot be loaded`.
5. **Enable/disable from the list.** PUT replaces the whole definition, so the toggle must send it back unchanged except `enabled`, and nothing the backend computed. *Task 2:* `keeps the definition and drops what the backend computed`. *Task 4:* `disables a job by sending its whole definition back, enabled off`.

## File Structure

```text
docker-jobs-app/
├── .config/ .cprc.json .eslintrc .prettierrc.js .nvmrc .gitignore tsconfig.json   copied, scaffold-owned
├── jest.config.js jest-setup.js         copied; jest-setup.js gains a canvas stub (Task 6)
├── package.json package-lock.json        copied, renamed docker-jobs-app
├── LICENSE CHANGELOG.md README.md
├── Dockerfile .dockerignore docker/nginx.conf scripts/package.sh       delivery (Task 8)
├── docker-compose.yaml provisioning/{plugins/apps.yaml,datasources/loki.yaml}   local Grafana (Task 8)
├── .github/workflows/docker-jobs-app.yml                               CI (Task 8)
├── docs/superpowers/plans/2026-10-09-docker-jobs-app.md                this plan
└── src/
    ├── plugin.json            id, proxy routes, pages, dashboard include
    ├── module.tsx             AppPlugin: root page + configuration page
    ├── constants.ts           PLUGIN_ID, ROUTES, API_BASE, prefixRoute
    ├── settings.ts            AppJsonData, AppSettings context, useAppSettings
    ├── api.ts                 backend types + typed calls + errorMessage
    ├── utils.ts               dates, state colours, canEdit, splitCommandLine, exploreUrl, emptyJob, jobToSpec
    ├── test-fixtures.ts       aJob/aRun/anAttempt          test-utils.tsx   renderAt/asRole/fetchError
    ├── components/App/App.tsx                 routes, "not configured" guard
    ├── components/AppConfig/AppConfig.tsx     backend URL, API token, Loki datasource
    ├── components/Truncated/Truncated.tsx     one-line cell with tooltip
    ├── components/editors/{StringListEditor,KeyValueEditor,RowsEditor}.tsx
    ├── pages/Jobs.tsx  pages/JobEditor.tsx  pages/Runs.tsx  pages/RunDetails.tsx
    ├── dashboards/overview.json               bundled dashboard
    └── img/logo.svg
```

---

### Task 1: Repository, toolchain, plugin shell and configuration page

**Files:**
- Create (copied from `../download-manager/maas-dm-app`): `.config/`, `.cprc.json`, `.eslintrc`, `.prettierrc.js`, `.nvmrc`, `.gitignore`, `tsconfig.json`, `jest.config.js`, `jest-setup.js`, `package.json`, `package-lock.json`, `LICENSE`, `src/img/logo.svg`
- Create: `CHANGELOG.md`, `README.md` (stub), `src/plugin.json`, `src/constants.ts`, `src/settings.ts`, `src/module.tsx`, `src/components/App/App.tsx`, `src/components/AppConfig/AppConfig.tsx`, `src/components/Truncated/Truncated.tsx`
- Test: `src/components/App/App.test.tsx`, `src/components/AppConfig/AppConfig.test.tsx`

**Interfaces:**
- Produces:
  - `PLUGIN_ID`, `PLUGIN_BASE_URL`, `enum ROUTES { Jobs = 'jobs', Runs = 'runs' }`, `API_BASE` and `prefixRoute(route: string): string` (constants.ts);
  - `type AppJsonData = { backendUrl?: string; lokiDatasourceUid?: string }`, the `AppSettings` React context, and `useAppSettings(): AppJsonData` (settings.ts);
  - `Truncated({ text, maxWidth })`;
  - App renders its routes inside `<AppSettings.Provider value={meta.jsonData}>`.

- [ ] **Step 1: Create the repository and copy the toolchain**

```bash
cd /home/aagazzi/work/docker-jobs-app
git init -b develop
T=../download-manager/maas-dm-app
cp -r $T/.config $T/.cprc.json $T/.eslintrc $T/.prettierrc.js $T/.nvmrc $T/.gitignore \
      $T/tsconfig.json $T/jest.config.js $T/jest-setup.js $T/package.json $T/package-lock.json $T/LICENSE .
mkdir -p src/img src/components/App src/components/AppConfig src/components/Truncated
cp $T/src/img/logo.svg src/img/logo.svg
npm pkg set name=docker-jobs-app version=0.1.0 \
  description="Docker Jobs: the Grafana app of docker-jobs-backend -- jobs, runs, reruns, cancels"
# the lockfile names the package twice: the root and packages[""]
sed -i '0,/"name": "maas-dm-app"/s//"name": "docker-jobs-app"/' package-lock.json
sed -i '0,/"name": "maas-dm-app"/s//"name": "docker-jobs-app"/' package-lock.json
grep -c maas-dm-app package-lock.json   # 0
printf '# Changelog\n\n## 0.1.0\n\n- Jobs, job editor, runs and attempts, rerun and cancel, overview dashboard.\n' > CHANGELOG.md
printf '# docker-jobs-app\n\nThe Grafana app of docker-jobs-backend. Task 8 completes this README.\n' > README.md
npm ci --no-audit --no-fund
```

Expected: the `grep` prints `0`, and `npm ci` ends with `added 1232 packages`. The `npm warn deprecated eslint@8.57.1` line is the scaffold's and is harmless.

- [ ] **Step 2: Write the plugin shell**

`src/plugin.json`. Task 7 adds the dashboard include:

```json
{
  "$schema": "https://raw.githubusercontent.com/grafana/grafana/main/docs/sources/developers/plugins/plugin.schema.json",
  "type": "app",
  "name": "Docker Jobs",
  "id": "ocs-dockerjobs-app",
  "backend": false,
  "info": {
    "keywords": ["app", "docker", "swarm", "cron", "jobs"],
    "description": "Scheduled jobs on Docker Swarm: define them, follow their runs, rerun or cancel them",
    "author": {
      "name": "Serco - Space unit"
    },
    "logos": {
      "small": "img/logo.svg",
      "large": "img/logo.svg"
    },
    "screenshots": [],
    "version": "%VERSION%",
    "updated": "%TODAY%"
  },
  "routes": [
    {
      "path": "api/*",
      "method": "GET",
      "reqRole": "Viewer",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    },
    {
      "path": "api/*",
      "method": "POST",
      "reqRole": "Editor",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    },
    {
      "path": "api/*",
      "method": "PUT",
      "reqRole": "Editor",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    },
    {
      "path": "api/*",
      "method": "DELETE",
      "reqRole": "Editor",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    }
  ],
  "includes": [
    {
      "type": "page",
      "name": "Jobs",
      "path": "/a/%PLUGIN_ID%/jobs",
      "role": "Viewer",
      "addToNav": true,
      "defaultNav": true
    },
    {
      "type": "page",
      "name": "Runs",
      "path": "/a/%PLUGIN_ID%/runs",
      "role": "Viewer",
      "addToNav": true,
      "defaultNav": false
    },
    {
      "type": "page",
      "icon": "cog",
      "name": "Configuration",
      "path": "/plugins/%PLUGIN_ID%",
      "role": "Admin",
      "addToNav": true
    }
  ],
  "dependencies": {
    "grafanaDependency": ">=13.2.0",
    "plugins": []
  }
}
```

`src/constants.ts`:

```ts
import pluginJson from './plugin.json';

export const PLUGIN_ID = pluginJson.id;

export const PLUGIN_BASE_URL = `/a/${PLUGIN_ID}`;

export enum ROUTES {
  Jobs = 'jobs',
  Runs = 'runs',
}

// Every call goes through Grafana's plugin proxy (plugin.json routes): it
// forwards to the backendUrl set on the configuration page, adds the API token
// kept in secureJsonData, checks the caller's role -- Viewer for GET, Editor
// for the rest -- and, with [dataproxy] send_user_header, sets X-Grafana-User,
// which the backend records as whoever triggered, reran or cancelled a run.
export const API_BASE = `/api/plugin-proxy/${PLUGIN_ID}/api/v1`;

export function prefixRoute(route: string): string {
  return `${PLUGIN_BASE_URL}/${route}`;
}
```

`src/settings.ts`:

```ts
import { createContext, useContext } from 'react';

/** The app's jsonData, set on its configuration page. */
export type AppJsonData = {
  // Where Grafana's plugin proxy forwards /api/plugin-proxy/ocs-dockerjobs-app/api/...
  // As the Grafana server reaches it: in the swarm, the backend's service name.
  backendUrl?: string;
  // The Loki datasource the attempts' "Logs" links open in Explore.
  lokiDatasourceUid?: string;
};

export const AppSettings = createContext<AppJsonData>({});

/** The app's jsonData, for any page below App. */
export function useAppSettings(): AppJsonData {
  return useContext(AppSettings);
}
```

`src/module.tsx`:

```tsx
import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

import type { AppConfigProps } from './components/AppConfig/AppConfig';
import type { AppJsonData } from './settings';

const LazyApp = lazy(() => import('./components/App/App'));
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));

const App = (props: AppRootProps<AppJsonData>) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyApp {...props} />
  </Suspense>
);

const AppConfig = (props: AppConfigProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyAppConfig {...props} />
  </Suspense>
);

export const plugin = new AppPlugin<AppJsonData>().setRootPage(App).addConfigPage({
  title: 'Configuration',
  icon: 'cog',
  body: AppConfig,
  id: 'configuration',
});
```

`src/components/Truncated/Truncated.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';

/**
 * One line, cut with an ellipsis, the whole text in the tooltip: an attempt's
 * error or node id would otherwise push a table's other columns off-screen.
 */
export function Truncated({ text, maxWidth = 420 }: { text?: string; maxWidth?: number }) {
  const styles = useStyles2(() => ({
    text: css({
      display: 'inline-block',
      maxWidth,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      verticalAlign: 'bottom',
    }),
  }));

  if (!text) {
    return <>–</>;
  }

  return (
    <span className={styles.text} title={text}>
      {text}
    </span>
  );
}
```

- [ ] **Step 3: Write the failing tests**

`src/components/App/App.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AppRootProps, PluginType } from '@grafana/data';

import App from './App';

function props(jsonData: object): AppRootProps {
  return {
    basename: '/a/ocs-dockerjobs-app',
    meta: { id: 'ocs-dockerjobs-app', name: 'Docker Jobs', type: PluginType.app, jsonData } as never,
    path: '',
    query: {},
  } as unknown as AppRootProps;
}

describe('App', () => {
  it('asks for the backend URL before anything else', () => {
    render(<App {...props({})} />);

    expect(screen.getByText('docker-jobs-backend is not configured')).toBeInTheDocument();
  });
});
```

`src/components/AppConfig/AppConfig.test.tsx`:

```tsx
import React from 'react';
import { of } from 'rxjs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PluginType } from '@grafana/data';

import AppConfig, { AppConfigProps } from './AppConfig';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ fetch: mockFetch }),
  // the real picker needs Grafana's datasource service
  DataSourcePicker: ({ onChange }: { onChange: (ds: { uid: string }) => void }) => (
    <button type="button" onClick={() => onChange({ uid: 'loki-uid' })}>
      pick loki
    </button>
  ),
}));

function props(jsonData: object, secureJsonFields: object = {}): AppConfigProps {
  return {
    plugin: {
      meta: { id: 'ocs-dockerjobs-app', type: PluginType.app, enabled: true, pinned: true, jsonData, secureJsonFields },
    },
    query: {},
  } as unknown as AppConfigProps;
}

describe('AppConfig', () => {
  const reload = window.location.reload;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockReturnValue(of({ data: {} }));
    Object.defineProperty(window, 'location', { value: { reload: jest.fn() }, writable: true });
  });
  afterAll(() => {
    Object.defineProperty(window, 'location', { value: { reload }, writable: true });
  });

  it('saves the URL without a trailing slash, the Loki datasource and the token', async () => {
    render(<AppConfig {...props({})} />);

    fireEvent.change(screen.getByLabelText(/backend url/i), {
      target: { value: ' http://docker-jobs_backend:8000/ ' },
    });
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByText('pick loki'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toMatchObject({
      url: '/api/plugins/ocs-dockerjobs-app/settings',
      method: 'POST',
      data: {
        jsonData: { backendUrl: 'http://docker-jobs_backend:8000', lokiDatasourceUid: 'loki-uid' },
        secureJsonData: { apiToken: 's3cret' },
      },
    });
  });

  it('keeps a stored token unless it is reset', async () => {
    render(<AppConfig {...props({ backendUrl: 'http://b:8000' }, { apiToken: true })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0].data.secureJsonData).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `npm run test:ci`
Expected: both suites fail with `Cannot find module './App'` and `Cannot find module './AppConfig'`.

- [ ] **Step 5: Write the App shell and the configuration page**

`src/components/App/App.tsx`. Tasks 4–6 add the routes:

```tsx
import React from 'react';
import { Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { Alert } from '@grafana/ui';

import { AppSettings, type AppJsonData } from '../../settings';

function App({ meta }: AppRootProps<AppJsonData>) {
  if (!meta.jsonData?.backendUrl) {
    return (
      <Alert severity="warning" title="docker-jobs-backend is not configured">
        An administrator has to set its URL on the app&apos;s configuration page (Administration → Plugins → Docker
        Jobs).
      </Alert>
    );
  }

  return (
    <AppSettings.Provider value={meta.jsonData}>
      {/* the pages' routes come with the pages */}
      <Routes />
    </AppSettings.Provider>
  );
}

export default App;
```

`src/components/AppConfig/AppConfig.tsx`:

```tsx
import React, { SyntheticEvent, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { DataSourcePicker, getBackendSrv } from '@grafana/runtime';
import { Alert, Button, Field, FieldSet, Input, SecretInput, Stack } from '@grafana/ui';

import type { AppJsonData } from '../../settings';

type AppSecureJsonData = {
  // The backend's API_TOKEN; the proxy routes send it as a bearer token.
  apiToken?: string;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppJsonData>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [backendUrl, setBackendUrl] = useState(jsonData?.backendUrl ?? '');
  const [lokiDatasourceUid, setLokiDatasourceUid] = useState(jsonData?.lokiDatasourceUid ?? '');
  const [apiToken, setApiToken] = useState('');
  const [tokenIsSet, setTokenIsSet] = useState(Boolean(secureJsonFields?.apiToken));

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        backendUrl: backendUrl.trim().replace(/\/+$/, ''),
        lokiDatasourceUid: lokiDatasourceUid || undefined,
      },
      // left out, the stored token is kept; sent empty, it is cleared
      secureJsonData: tokenIsSet ? undefined : { apiToken: apiToken.trim() },
    });
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="docker-jobs-backend">
        <Stack direction="column" gap={2}>
          <Field
            label="Backend URL"
            description="As the Grafana server reaches it, without /api, e.g. http://docker-jobs_backend:8000"
          >
            <Input
              width={60}
              id="config-backend-url"
              value={backendUrl}
              placeholder="http://docker-jobs_backend:8000"
              onChange={(event) => setBackendUrl(event.currentTarget.value)}
            />
          </Field>
          <Field label="API token" description="The backend's API_TOKEN; empty if the backend sets none">
            <SecretInput
              width={60}
              id="config-api-token"
              isConfigured={tokenIsSet}
              value={apiToken}
              onReset={() => {
                setTokenIsSet(false);
                setApiToken('');
              }}
              onChange={(event) => setApiToken(event.currentTarget.value)}
            />
          </Field>
          <Field label="Loki datasource" description="Where the jobs' logs are: the attempts' Logs links open it">
            <DataSourcePicker
              type="loki"
              current={lokiDatasourceUid || null}
              noDefault
              width={60}
              onChange={(datasource) => setLokiDatasourceUid(datasource.uid)}
            />
          </Field>
          <Alert severity="info" title="Who did it">
            Set [dataproxy] send_user_header = true (GF_DATAPROXY_SEND_USER_HEADER=true) so the backend records the
            Grafana login of whoever triggers, reruns or cancels a run. Without it, everything is anonymous.
          </Alert>
          <div>
            <Button type="submit" disabled={!backendUrl.trim()}>
              Save
            </Button>
          </div>
        </Stack>
      </FieldSet>
    </form>
  );
};

export default AppConfig;

const updatePluginAndReload = async (
  pluginId: string,
  data: Partial<PluginMeta<AppJsonData>> & { secureJsonData?: AppSecureJsonData }
) => {
  await lastValueFrom(
    getBackendSrv().fetch({
      url: `/api/plugins/${pluginId}/settings`,
      method: 'POST',
      data,
    })
  );
  // the proxy routes are templated from jsonData when the page loads
  window.location.reload();
};
```

- [ ] **Step 6: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint && npm run build`
Expected:
- `Tests: 3 passed, 3 total`;
- no typecheck output;
- no lint problems;
- `webpack … compiled successfully`, with `dist/plugin.json` showing `"id": "ocs-dockerjobs-app"`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: plugin shell and configuration page of the Docker Jobs app" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

`git add -A` is safe here: `.gitignore` (copied) keeps out `node_modules/`, `dist/`, `coverage/`, zips and `.eslintcache`. Check with `git status --short` that only the files above are staged, plus this plan under `docs/`.

---

### Task 2: API client and helpers

**Files:**
- Create: `src/api.ts`, `src/utils.ts`, `src/test-fixtures.ts`
- Test: `src/api.test.ts`, `src/utils.test.ts`

**Interfaces:**
- Consumes: `API_BASE` (Task 1).
- Produces:
  - **Types:** `SecretRef`, `ConfigRef`, `MountSpec`, `JobSpec`, `JobCreate` (= `JobSpec` + `name`), `Job` (+ `start_date: string`, `schedule_cursor`, `created_at`, `updated_at`, `updated_by`, `next_fire_at`), `RunState`, `AttemptState`, `Attempt`, `Run`, `Preview`, `RunFilters`.
  - **Calls**, all returning a `Promise`:
    - `listJobs()`, `getJob(name)`, `createJob(job)`, `updateJob(name, spec)`, `deleteJob(name)`;
    - `triggerJob(name, logicalDate?, note?)`, `previewJob(job, logicalDate?)`;
    - `listRuns(filters)`, `getRun(id)`, `rerunRun(id, note?)`, `cancelRun(id, note?)`.
  - `errorMessage(error: unknown): string`.
  - **Helpers in `utils.ts`:** `formatDate`, `formatInterval`, `ENDED_STATES`, `isEnded`, `stateColor`, `canEdit`, `splitCommandLine`, `exploreUrl(datasourceUid, selector, start?, end?)`, `emptyJob(): JobCreate`, `jobToSpec(job: Job): JobSpec`.
  - **Test fixtures:** `aJob`, `aRun`, `anAttempt`.

- [ ] **Step 1: Write the fixtures and the failing tests**

`src/test-fixtures.ts`:

```ts
// Test data shaped like docker-jobs-backend's responses.
import type { Attempt, Job, Run } from './api';
import { emptyJob } from './utils';

export function aJob(overrides: Partial<Job> = {}): Job {
  return {
    ...emptyJob(),
    name: 'collect',
    image: '127.0.0.1:8085/maas-collector:3.10.1',
    command: ['--start', '{{ data_interval_start | iso_ms }}'],
    start_date: '2026-10-09T00:00:00Z',
    schedule_cursor: null,
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
    updated_by: 'aagazzi',
    next_fire_at: '2026-10-09T11:00:00Z',
    ...overrides,
  };
}

export function anAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    try_number: 1,
    reason: 'scheduled',
    state: 'success',
    requested_by: '',
    note: '',
    not_before: null,
    created_at: '2026-10-09T01:00:00Z',
    launched_at: '2026-10-09T01:00:05Z',
    started_at: '2026-10-09T01:00:10Z',
    finished_at: '2026-10-09T01:02:00Z',
    service_name: 'djobs_collect_7_1',
    node_id: 'node-1',
    rendered_entrypoint: null,
    rendered_command: ['--start', '2026-10-09T00:00:00.000Z'],
    exit_code: 0,
    error: null,
    loki_selector: '{swarm_stack="djobs", swarm_service="djobs_collect_7_1"}',
    ...overrides,
  };
}

export function aRun(overrides: Partial<Run> = {}): Run {
  const attempt = anAttempt();
  return {
    id: 7,
    job: 'collect',
    run_type: 'scheduled',
    state: 'success',
    logical_date: '2026-10-09T00:00:00Z',
    data_interval_start: '2026-10-09T00:00:00Z',
    data_interval_end: '2026-10-09T01:00:00Z',
    try_number: 1,
    max_tries: 1,
    created_at: '2026-10-09T01:00:00Z',
    started_at: '2026-10-09T01:00:05Z',
    finished_at: '2026-10-09T01:02:00Z',
    requested_by: '',
    note: '',
    last_attempt: attempt,
    attempts: [attempt],
    ...overrides,
  };
}
```

`src/utils.test.ts`:

```ts
import { config } from '@grafana/runtime';

import { aJob } from './test-fixtures';
import {
  canEdit,
  exploreUrl,
  formatDate,
  formatInterval,
  isEnded,
  jobToSpec,
  splitCommandLine,
  stateColor,
} from './utils';

describe('formatDate', () => {
  it('shows UTC to the second, a dash for nothing, the value for garbage', () => {
    expect(formatDate('2026-10-09T01:02:03.456Z')).toBe('2026-10-09 01:02:03');
    expect(formatDate(null)).toBe('–');
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('formatInterval', () => {
  it('names the end date only when it differs', () => {
    expect(formatInterval('2026-10-09T00:00:00Z', '2026-10-09T01:00:00Z')).toBe('2026-10-09 00:00 → 01:00');
    expect(formatInterval('2026-10-08T13:00:00Z', '2026-10-09T01:00:00Z')).toBe('2026-10-08 13:00 → 2026-10-09 01:00');
  });
});

describe('states', () => {
  it('knows which runs have ended', () => {
    expect(['success', 'failed', 'cancelled'].every((state) => isEnded(state as never))).toBe(true);
    expect(['queued', 'running', 'retrying'].some((state) => isEnded(state as never))).toBe(false);
  });

  it('colours success green and failures red', () => {
    expect(stateColor('success')).toBe('green');
    expect(stateColor('failed')).toBe('red');
    expect(stateColor('lost')).toBe('red');
  });
});

describe('splitCommandLine', () => {
  it('splits on spaces and keeps quoted text together', () => {
    expect(splitCommandLine(`python -m mod --name "two words" --x 'a b' c\\ d`)).toEqual([
      'python',
      '-m',
      'mod',
      '--name',
      'two words',
      '--x',
      'a b',
      'c d',
    ]);
  });

  it('never splits a template, spaces and all', () => {
    expect(
      splitCommandLine(
        '--start {{ data_interval_start | iso_ms }} --end={{ (data_interval_end - timedelta(days=1)) | iso_ms }}'
      )
    ).toEqual([
      '--start',
      '{{ data_interval_start | iso_ms }}',
      '--end={{ (data_interval_end - timedelta(days=1)) | iso_ms }}',
    ]);
  });

  it('keeps an empty quoted argument and unescapes inside double quotes', () => {
    expect(splitCommandLine(`--note "" "say \\"hi\\""`)).toEqual(['--note', '', 'say "hi"']);
  });

  it('refuses an unclosed quote or template', () => {
    expect(() => splitCommandLine('--name "oops')).toThrow('unclosed "');
    expect(() => splitCommandLine('--start {{ data_interval_start')).toThrow('unclosed template {{');
  });

  it('gives nothing for blank text', () => {
    expect(splitCommandLine('   ')).toEqual([]);
  });
});

describe('exploreUrl', () => {
  it('opens the selector in Explore from a minute before to a minute after', () => {
    const url = exploreUrl(
      'loki-uid',
      '{swarm_service="djobs_collect_7_1"}',
      '2026-10-09T01:00:00Z',
      '2026-10-09T01:02:00Z'
    );

    const panes = JSON.parse(new URLSearchParams(url.split('?')[1]).get('panes')!);
    expect(url.startsWith('/explore?schemaVersion=1&panes=')).toBe(true);
    expect(panes.logs.datasource).toBe('loki-uid');
    expect(panes.logs.queries[0].expr).toBe('{swarm_service="djobs_collect_7_1"}');
    expect(panes.logs.range).toEqual({
      from: String(Date.parse('2026-10-09T00:59:00Z')),
      to: String(Date.parse('2026-10-09T01:03:00Z')),
    });
  });

  it('runs to now for an attempt still running', () => {
    const url = exploreUrl('loki-uid', '{}', '2026-10-09T01:00:00Z', null);
    expect(JSON.parse(new URLSearchParams(url.split('?')[1]).get('panes')!).logs.range.to).toBe('now');
  });
});

describe('jobToSpec', () => {
  it('keeps the definition and drops what the backend computed', () => {
    const spec = jobToSpec(aJob());

    expect(spec).not.toHaveProperty('name');
    expect(spec).not.toHaveProperty('next_fire_at');
    expect(spec).not.toHaveProperty('created_at');
    expect(spec).not.toHaveProperty('schedule_cursor');
    expect(spec.command).toEqual(['--start', '{{ data_interval_start | iso_ms }}']);
    expect(spec.start_date).toBe('2026-10-09T00:00:00Z');
  });
});

describe('canEdit', () => {
  afterEach(() => {
    config.bootData.user = {} as never;
  });

  it('lets Editors, Admins and Grafana admins edit, not Viewers', () => {
    config.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: false } as never;
    expect(canEdit()).toBe(false);
    config.bootData.user = { orgRole: 'Editor', isGrafanaAdmin: false } as never;
    expect(canEdit()).toBe(true);
    config.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: true } as never;
    expect(canEdit()).toBe(true);
  });
});
```

`src/api.test.ts`:

```ts
import { of } from 'rxjs';

import { cancelRun, errorMessage, listRuns, previewJob, rerunRun, triggerJob, updateJob } from './api';
import { aJob } from './test-fixtures';
import { jobToSpec } from './utils';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

const BASE = '/api/plugin-proxy/ocs-dockerjobs-app/api/v1';

/** the options of the only call made */
function sent() {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  return mockFetch.mock.calls[0][0];
}

describe('the API client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockReturnValue(of({ data: {} }));
  });

  it('PUTs a job definition at its escaped name', async () => {
    const spec = jobToSpec(aJob());
    await updateJob('a b', spec);

    expect(sent()).toMatchObject({ method: 'PUT', url: `${BASE}/jobs/a%20b`, data: spec, showErrorAlert: false });
  });

  it('triggers the latest interval unless given a date', async () => {
    await triggerJob('collect');

    expect(sent()).toMatchObject({
      method: 'POST',
      url: `${BASE}/jobs/collect/trigger`,
      data: { logical_date: undefined, note: '' },
    });
  });

  it('previews a definition for an interval', async () => {
    const job = aJob();
    await previewJob(job, '2026-10-09T00:30:00Z');

    expect(sent()).toMatchObject({
      method: 'POST',
      url: `${BASE}/preview`,
      data: { job, logical_date: '2026-10-09T00:30:00Z' },
    });
  });

  it('filters runs with query parameters', async () => {
    await listRuns({ job: 'collect', state: 'failed', offset: 50, size: 50 });

    expect(sent()).toMatchObject({
      method: 'GET',
      url: `${BASE}/runs`,
      params: { job: 'collect', state: 'failed', offset: 50, size: 50 },
    });
  });

  it('reruns and cancels with a note', async () => {
    await rerunRun(7, 'upstream fixed');
    await cancelRun(8, 'wrong window');

    expect(mockFetch.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/runs/7/rerun`,
      data: { note: 'upstream fixed' },
    });
    expect(mockFetch.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/runs/8/cancel`,
      data: { note: 'wrong window' },
    });
  });
});

describe('errorMessage', () => {
  const fetchError = (data: unknown, status = 422) => ({ status, statusText: 'Unprocessable', data, config: {} });

  it('shows the backend detail', () => {
    expect(errorMessage(fetchError({ detail: 'job is disabled' }, 409))).toBe('job is disabled');
  });

  it('shows where each validation error is', () => {
    const detail = [
      { loc: ['body', 'command'], msg: "Value error, template command[1]: 'nope' is undefined" },
      { loc: ['body', 'name'], msg: 'String should match pattern' },
    ];

    expect(errorMessage(fetchError({ detail }))).toBe(
      "command: Value error, template command[1]: 'nope' is undefined; name: String should match pattern"
    );
  });

  it('falls back to Grafana message, then the status, then the error', () => {
    expect(errorMessage(fetchError({ message: 'plugin route match not found' }, 404))).toBe(
      'plugin route match not found'
    );
    expect(errorMessage(fetchError(undefined, 502))).toBe('502 Unprocessable');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:ci`
Expected: the two new suites fail with `Cannot find module './utils'` and `'./api'`.

- [ ] **Step 3: Write the client and the helpers**

`src/api.ts`:

```ts
import { getBackendSrv, isFetchError } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { API_BASE } from './constants';

// The bodies of docker-jobs-backend's API (its schemas.py). Datetimes are ISO
// 8601 strings with a timezone, UTC as the backend sends them ("...Z").

export interface SecretRef {
  source: string;
  target: string;
  uid: string;
  gid: string;
  mode: number;
}

export interface ConfigRef {
  source: string;
  target: string;
  uid: string;
  gid: string;
  mode: number;
}

export interface MountSpec {
  type: 'volume' | 'bind' | 'tmpfs';
  source: string;
  target: string;
  read_only: boolean;
}

/** A job's definition: what PUT /jobs/{name} takes. */
export interface JobSpec {
  description: string;
  image: string;
  entrypoint: string[] | null;
  command: string[];
  env: Record<string, string>;
  params: Record<string, string>;
  schedule: string;
  start_date: string | null;
  end_date: string | null;
  enabled: boolean;
  catchup: boolean;
  max_active_runs: number;
  retries: number;
  retry_delay_seconds: number;
  timeout_seconds: number;
  networks: string[];
  constraints: string[];
  secrets: SecretRef[];
  configs: ConfigRef[];
  mounts: MountSpec[];
  cpu_limit: number | null;
  memory_limit_mb: number | null;
}

/** What POST /jobs takes. */
export interface JobCreate extends JobSpec {
  name: string;
}

/** A job as the API returns it. */
export interface Job extends JobCreate {
  start_date: string;
  schedule_cursor: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
  next_fire_at: string | null;
}

export type RunState = 'queued' | 'running' | 'retrying' | 'success' | 'failed' | 'cancelled';
export type AttemptState = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'lost' | 'cancelled';

export interface Attempt {
  try_number: number;
  reason: string;
  state: AttemptState;
  requested_by: string;
  note: string;
  not_before: string | null;
  created_at: string;
  launched_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  service_name: string | null;
  node_id: string | null;
  rendered_entrypoint: string[] | null;
  rendered_command: string[] | null;
  exit_code: number | null;
  error: string | null;
  loki_selector: string | null;
}

export interface Run {
  id: number;
  job: string;
  run_type: 'scheduled' | 'manual';
  state: RunState;
  logical_date: string;
  data_interval_start: string;
  data_interval_end: string;
  try_number: number;
  max_tries: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  requested_by: string;
  note: string;
  last_attempt: Attempt | null;
  // only GET /runs/{id} and the actions fill it
  attempts: Attempt[] | null;
}

export interface Preview {
  data_interval_start: string;
  data_interval_end: string;
  entrypoint: string[] | null;
  command: string[];
  env: Record<string, string>;
  next_fire_times: string[];
  problems: string[];
}

export interface RunFilters {
  job?: string;
  state?: RunState;
  offset?: number;
  size?: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function call<T>(method: Method, path: string, body?: unknown, params?: object): Promise<T> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<T>({
      method,
      url: `${API_BASE}${path}`,
      data: body,
      params,
      // the pages show errors inline, next to what failed
      showErrorAlert: false,
    })
  );
  return response.data;
}

const job = (name: string) => `/jobs/${encodeURIComponent(name)}`;

export const listJobs = () => call<Job[]>('GET', '/jobs');

export const getJob = (name: string) => call<Job>('GET', job(name));

export const createJob = (definition: JobCreate) => call<Job>('POST', '/jobs', definition);

export const updateJob = (name: string, spec: JobSpec) => call<Job>('PUT', job(name), spec);

export const deleteJob = (name: string) => call<void>('DELETE', job(name));

/** A manual run: of the interval logicalDate falls in, or of the latest that ended. */
export const triggerJob = (name: string, logicalDate?: string, note = '') =>
  call<Run>('POST', `${job(name)}/trigger`, { logical_date: logicalDate || undefined, note });

/** What a definition would run, without saving it. */
export const previewJob = (definition: JobCreate, logicalDate?: string) =>
  call<Preview>('POST', '/preview', { job: definition, logical_date: logicalDate || undefined });

export const listRuns = (filters: RunFilters = {}) => call<Run[]>('GET', '/runs', undefined, filters);

export const getRun = (id: number) => call<Run>('GET', `/runs/${id}`);

export const rerunRun = (id: number, note = '') => call<Run>('POST', `/runs/${id}/rerun`, { note });

export const cancelRun = (id: number, note = '') => call<Run>('POST', `/runs/${id}/cancel`, { note });

/** A readable message for a failed call: FastAPI's detail, Grafana's message, or the error. */
export function errorMessage(error: unknown): string {
  if (isFetchError(error)) {
    const data = error.data as { detail?: unknown; message?: string } | undefined;

    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      // pydantic validation errors: where, then what
      return data.detail
        .map((item: { loc?: Array<string | number>; msg?: string }) => {
          const where = (item.loc ?? []).filter((part) => part !== 'body').join('.');
          return where ? `${where}: ${item.msg}` : item.msg ?? JSON.stringify(item);
        })
        .join('; ');
    }
    if (data?.message) {
      return data.message;
    }
    return `${error.status ?? ''} ${error.statusText ?? 'request failed'}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
```

`src/utils.ts`:

```ts
import { config } from '@grafana/runtime';
import type { BadgeColor } from '@grafana/ui';

import type { AttemptState, Job, JobCreate, JobSpec, RunState } from './api';

/** A UTC timestamp as "YYYY-MM-DD HH:mm:ss", or a dash. */
export function formatDate(value?: string | null): string {
  if (!value) {
    return '–';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/** A data interval: "2026-10-09 00:00 → 01:00", the end's date only when it differs. */
export function formatInterval(start: string, end: string): string {
  const from = formatDate(start).slice(0, 16);
  const to = formatDate(end).slice(0, 16);
  return from.slice(0, 10) === to.slice(0, 10) ? `${from} → ${to.slice(11)}` : `${from} → ${to}`;
}

export const ENDED_STATES: RunState[] = ['success', 'failed', 'cancelled'];

/** A run that will not change unless someone reruns it. */
export function isEnded(state: RunState): boolean {
  return ENDED_STATES.includes(state);
}

export function stateColor(state: RunState | AttemptState): BadgeColor {
  switch (state) {
    case 'success':
      return 'green';
    case 'running':
      return 'blue';
    case 'retrying':
    case 'timeout':
      return 'orange';
    case 'failed':
    case 'lost':
      return 'red';
    default:
      // queued, pending, cancelled
      return 'darkgrey';
  }
}

/** Editors and admins may change jobs and runs; the proxy refuses the others anyway. */
export function canEdit(): boolean {
  const user = config.bootData.user;
  return Boolean(user?.isGrafanaAdmin) || user?.orgRole === 'Editor' || user?.orgRole === 'Admin';
}

/**
 * A command line into arguments, the way a shell would split it -- spaces
 * separate, quotes group, a backslash escapes -- except that a Jinja
 * {{ ... }} or {% ... %} is never split: `--start {{ data_interval_start | iso_ms }}`
 * is two arguments. Throws on an unclosed quote or template.
 */
export function splitCommandLine(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let i = 0;

  const take = (closing: string, what: string) => {
    const end = text.indexOf(closing, i + 2);
    if (end < 0) {
      throw new Error(`unclosed ${what}`);
    }
    current += text.slice(i, end + closing.length);
    started = true;
    i = end + closing.length;
  };

  while (i < text.length) {
    const char = text[i];
    const pair = text.slice(i, i + 2);

    if (pair === '{{') {
      take('}}', 'template {{');
    } else if (pair === '{%') {
      take('%}', 'template {%');
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
      i += 1;
    } else if (char === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) {
        throw new Error("unclosed '");
      }
      current += text.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (char === '"') {
      i += 1;
      started = true;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) {
          i += 1;
        }
        current += text[i];
        i += 1;
      }
      if (i >= text.length) {
        throw new Error('unclosed "');
      }
      i += 1;
    } else if (char === '\\' && i + 1 < text.length) {
      current += text[i + 1];
      started = true;
      i += 2;
    } else {
      current += char;
      started = true;
      i += 1;
    }
  }
  if (started) {
    args.push(current);
  }
  return args;
}

/** Grafana Explore on a Loki selector, from a little before start to a little after end (or now). */
export function exploreUrl(
  datasourceUid: string,
  selector: string,
  start?: string | null,
  end?: string | null
): string {
  const margin = 60_000;
  const from = start ? String(new Date(start).getTime() - margin) : 'now-1h';
  const to = end ? String(new Date(end).getTime() + margin) : 'now';
  const panes = {
    logs: {
      datasource: datasourceUid,
      queries: [{ refId: 'A', expr: selector, datasource: { type: 'loki', uid: datasourceUid } }],
      range: { from, to },
    },
  };
  return `/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

/** A new job, with the backend's defaults. */
export function emptyJob(): JobCreate {
  return {
    name: '',
    description: '',
    image: '',
    entrypoint: null,
    command: [],
    env: {},
    params: {},
    schedule: '0 * * * *',
    start_date: null,
    end_date: null,
    enabled: true,
    catchup: true,
    max_active_runs: 1,
    retries: 0,
    retry_delay_seconds: 300,
    timeout_seconds: 3600,
    networks: [],
    constraints: [],
    secrets: [],
    configs: [],
    mounts: [],
    cpu_limit: null,
    memory_limit_mb: null,
  };
}

/** A job's definition only: what PUT /jobs/{name} takes, nothing the backend computed. */
export function jobToSpec(job: Job): JobSpec {
  return {
    description: job.description,
    image: job.image,
    entrypoint: job.entrypoint,
    command: job.command,
    env: job.env,
    params: job.params,
    schedule: job.schedule,
    start_date: job.start_date,
    end_date: job.end_date,
    enabled: job.enabled,
    catchup: job.catchup,
    max_active_runs: job.max_active_runs,
    retries: job.retries,
    retry_delay_seconds: job.retry_delay_seconds,
    timeout_seconds: job.timeout_seconds,
    networks: job.networks,
    constraints: job.constraints,
    secrets: job.secrets,
    configs: job.configs,
    mounts: job.mounts,
    cpu_limit: job.cpu_limit,
    memory_limit_mb: job.memory_limit_mb,
  };
}
```

- [ ] **Step 4: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint`
Expected: `Tests: 24 passed, 24 total`, no type errors, no lint problems.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/utils.ts src/test-fixtures.ts src/api.test.ts src/utils.test.ts
git commit -m "feat: typed client of docker-jobs-backend and the app's helpers" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Form editors

**Files:**
- Create: `src/components/editors/StringListEditor.tsx`, `src/components/editors/KeyValueEditor.tsx`, `src/components/editors/RowsEditor.tsx`
- Test: `src/components/editors/editors.test.tsx`

**Interfaces:**
- Consumes: `splitCommandLine` (Task 2).
- Produces:
  - `StringListEditor({ label, value: string[], onChange, paste? })`;
  - `KeyValueEditor({ label, value: Record<string, string>, onChange })`, which keeps its own rows;
  - `RowsEditor<T>({ label, rows: T[], fields: RowField<T>[], empty: () => T, onChange })`;
  - `RowField<T> = { key, label, kind?: 'text' | 'bool' | 'choice', choices?, placeholder?, width? }`.
  - Accessible labels follow `"<label> <n>"`, `"<label> <n> <field>"`, `"Paste a command line into <label>s"`, `"Split into <label>s"`, `"Add <label>"` and `"Remove <label> <n>"`.

- [ ] **Step 1: Write the failing tests**

`src/components/editors/editors.test.tsx`:

```tsx
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { KeyValueEditor } from './KeyValueEditor';
import { RowsEditor } from './RowsEditor';
import { StringListEditor } from './StringListEditor';

/** an editor with its value held like a page would, the last value seen */
function Holder<T>({
  initial,
  editor,
}: {
  initial: T;
  editor: (value: T, onChange: (v: T) => void) => React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      {editor(value, setValue)}
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const value = () => JSON.parse(screen.getByTestId('value').textContent!);

describe('StringListEditor', () => {
  it('splits a pasted command line into one row per argument', () => {
    render(
      <Holder<string[]>
        initial={[]}
        editor={(v, onChange) => <StringListEditor label="argument" value={v} onChange={onChange} paste />}
      />
    );

    fireEvent.change(screen.getByLabelText('Paste a command line into arguments'), {
      target: { value: 'python -m mod --start {{ data_interval_start | iso_ms }}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split into arguments' }));

    expect(value()).toEqual(['python', '-m', 'mod', '--start', '{{ data_interval_start | iso_ms }}']);
    expect(screen.getByLabelText('argument 5')).toHaveValue('{{ data_interval_start | iso_ms }}');
  });

  it('says what is wrong with a line it cannot split', () => {
    render(
      <Holder<string[]>
        initial={['keep']}
        editor={(v, onChange) => <StringListEditor label="argument" value={v} onChange={onChange} paste />}
      />
    );

    fireEvent.change(screen.getByLabelText('Paste a command line into arguments'), { target: { value: '"oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Split into arguments' }));

    expect(screen.getByText('unclosed "')).toBeInTheDocument();
    expect(value()).toEqual(['keep']);
  });

  it('adds and removes rows', () => {
    render(
      <Holder<string[]>
        initial={['a', 'b']}
        editor={(v, onChange) => <StringListEditor label="argument" value={v} onChange={onChange} />}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove argument 1' }));
    fireEvent.click(screen.getByRole('button', { name: /add argument/i }));

    expect(value()).toEqual(['b', '']);
  });
});

describe('KeyValueEditor', () => {
  it('builds the dict from its rows, keyless rows left out', () => {
    render(
      <Holder<Record<string, string>>
        initial={{ IFACE: '{{ params.interface }}' }}
        editor={(v, onChange) => <KeyValueEditor label="variable" value={v} onChange={onChange} />}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    fireEvent.change(screen.getByLabelText('variable 2 value'), { target: { value: 'half typed' } });
    expect(value()).toEqual({ IFACE: '{{ params.interface }}' });

    fireEvent.change(screen.getByLabelText('variable 2 name'), { target: { value: 'NOTE' } });
    expect(value()).toEqual({ IFACE: '{{ params.interface }}', NOTE: 'half typed' });
  });
});

describe('RowsEditor', () => {
  type Mount = { type: string; source: string; target: string; read_only: boolean };

  it('edits each field of a row', () => {
    render(
      <Holder<Mount[]>
        initial={[]}
        editor={(v, onChange) => (
          <RowsEditor<Mount>
            label="mount"
            rows={v}
            fields={[
              { key: 'source', label: 'source' },
              { key: 'target', label: 'target' },
              { key: 'read_only', label: 'read only', kind: 'bool' },
            ]}
            empty={() => ({ type: 'volume', source: '', target: '', read_only: false })}
            onChange={onChange}
          />
        )}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add mount/i }));
    fireEvent.change(screen.getByLabelText('mount 1 source'), { target: { value: 'dm-work' } });
    fireEvent.change(screen.getByLabelText('mount 1 target'), { target: { value: '/work' } });
    fireEvent.click(screen.getByLabelText('mount 1 read only'));

    expect(value()).toEqual([{ type: 'volume', source: 'dm-work', target: '/work', read_only: true }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:ci`
Expected: `editors.test.tsx` fails with `Cannot find module './KeyValueEditor'`.

- [ ] **Step 3: Write the editors**

`src/components/editors/StringListEditor.tsx`:

```tsx
import React, { useState } from 'react';
import { Button, IconButton, Input, Stack, Text } from '@grafana/ui';

import { splitCommandLine } from '../../utils';

interface Props {
  /** what the rows are, for labels: "argument", "variable"... */
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  /** offer a box that splits a pasted command line into rows */
  paste?: boolean;
}

/**
 * One string per row -- one argument each, exactly what the container gets:
 * the backend runs commands exec-style, without a shell.
 */
export function StringListEditor({ label, value, onChange, paste = false }: Props) {
  const [line, setLine] = useState('');
  const [error, setError] = useState<string>();

  const set = (index: number, item: string) => onChange(value.map((old, i) => (i === index ? item : old)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const split = () => {
    try {
      onChange(splitCommandLine(line));
      setLine('');
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Stack direction="column" gap={1}>
      {value.map((item, index) => (
        <Stack key={index} gap={1} alignItems="center">
          <Input
            aria-label={`${label} ${index + 1}`}
            value={item}
            onChange={(event) => set(index, event.currentTarget.value)}
          />
          <IconButton name="trash-alt" tooltip={`Remove ${label} ${index + 1}`} onClick={() => remove(index)} />
        </Stack>
      ))}
      <div>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => onChange([...value, ''])}>
          Add {label}
        </Button>
      </div>
      {paste && (
        <Stack gap={1} alignItems="center">
          <Input
            aria-label={`Paste a command line into ${label}s`}
            placeholder='--start "{{ data_interval_start | iso_ms }}" --verbose'
            value={line}
            onChange={(event) => setLine(event.currentTarget.value)}
          />
          <Button size="sm" variant="secondary" disabled={!line.trim()} onClick={split}>
            Split into {label}s
          </Button>
        </Stack>
      )}
      {error && (
        <Text color="error" variant="bodySmall">
          {error}
        </Text>
      )}
    </Stack>
  );
}
```

`src/components/editors/KeyValueEditor.tsx`:

```tsx
import React, { useState } from 'react';
import { Button, IconButton, Input, Stack } from '@grafana/ui';

interface Props {
  /** what the keys are, for labels: "variable", "param" */
  label: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

type Row = { key: string; value: string };

/**
 * Key/value rows. The rows are this editor's own state -- a key being retyped,
 * or two rows with the same key, must not collapse while editing; the parent
 * gets the dict they make, rows without a key left out, the last duplicate
 * winning.
 */
export function KeyValueEditor({ label, value, onChange }: Props) {
  const [rows, setRows] = useState<Row[]>(() => Object.entries(value).map(([key, item]) => ({ key, value: item })));

  const update = (next: Row[]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])));
  };
  const set = (index: number, change: Partial<Row>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <Stack direction="column" gap={1}>
      {rows.map((row, index) => (
        <Stack key={index} gap={1} alignItems="center">
          <Input
            aria-label={`${label} ${index + 1} name`}
            placeholder="NAME"
            width={30}
            value={row.key}
            onChange={(event) => set(index, { key: event.currentTarget.value })}
          />
          <Input
            aria-label={`${label} ${index + 1} value`}
            placeholder="value, or a template"
            value={row.value}
            onChange={(event) => set(index, { value: event.currentTarget.value })}
          />
          <IconButton
            name="trash-alt"
            tooltip={`Remove ${label} ${index + 1}`}
            onClick={() => update(rows.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <div>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => update([...rows, { key: '', value: '' }])}>
          Add {label}
        </Button>
      </div>
    </Stack>
  );
}
```

`src/components/editors/RowsEditor.tsx`:

```tsx
import React from 'react';
import { Button, Checkbox, IconButton, Input, RadioButtonGroup, Stack } from '@grafana/ui';

/** One column of a RowsEditor. */
export interface RowField<T> {
  key: keyof T & string;
  label: string;
  kind?: 'text' | 'bool' | 'choice';
  choices?: string[];
  placeholder?: string;
  width?: number;
}

interface Props<T> {
  /** what a row is, for labels: "secret", "mount" */
  label: string;
  rows: T[];
  fields: Array<RowField<T>>;
  /** a new row */
  empty: () => T;
  onChange: (rows: T[]) => void;
}

/** Rows of a few fields each: the job's secrets, configs and mounts. */
export function RowsEditor<T extends object>({ label, rows, fields, empty, onChange }: Props<T>) {
  const set = (index: number, key: keyof T, item: unknown) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: item } : row)));

  return (
    <Stack direction="column" gap={1}>
      {rows.map((row, index) => (
        <Stack key={index} gap={1} alignItems="center">
          {fields.map((field) => {
            const name = `${label} ${index + 1} ${field.label}`;
            const current = row[field.key] as unknown;
            if (field.kind === 'bool') {
              return (
                <Checkbox
                  key={field.key}
                  aria-label={name}
                  label={field.label}
                  value={Boolean(current)}
                  onChange={(event) => set(index, field.key, event.currentTarget.checked)}
                />
              );
            }
            if (field.kind === 'choice') {
              return (
                <RadioButtonGroup
                  key={field.key}
                  aria-label={name}
                  options={(field.choices ?? []).map((choice) => ({ label: choice, value: choice }))}
                  value={String(current)}
                  onChange={(choice) => set(index, field.key, choice)}
                />
              );
            }
            return (
              <Input
                key={field.key}
                aria-label={name}
                placeholder={field.placeholder ?? field.label}
                width={field.width}
                value={String(current ?? '')}
                onChange={(event) => set(index, field.key, event.currentTarget.value)}
              />
            );
          })}
          <IconButton
            name="trash-alt"
            tooltip={`Remove ${label} ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <div>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => onChange([...rows, empty()])}>
          Add {label}
        </Button>
      </div>
    </Stack>
  );
}
```

- [ ] **Step 4: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint`
Expected: `Tests: 29 passed, 29 total`, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/editors
git commit -m "feat: list, key/value and row editors for the job form" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Jobs page

**Files:**
- Create: `src/pages/Jobs.tsx`, `src/test-utils.tsx`
- Modify: `src/components/App/App.tsx` (replace it with the version below)
- Test: `src/pages/Jobs.test.tsx`

**Interfaces:**
- Consumes: `listJobs`, `listRuns`, `triggerJob`, `updateJob`, `deleteJob`, `errorMessage`, `canEdit`, `formatDate`, `formatInterval`, `jobToSpec`, `stateColor` (Task 2); `ROUTES`, `prefixRoute` (Task 1).
- Produces:
  - `Jobs` (the default page);
  - `editRoute(name)` = `/a/ocs-dockerjobs-app/jobs/<name>/edit`;
  - `runsRoute(name)` = `/a/ocs-dockerjobs-app/runs?job=<name>`;
  - test helpers `renderAt(element, url?, path?)`, `asRole(role)` and `fetchError(data, status?)`.

- [ ] **Step 1: Write the test helpers and the failing tests**

`src/test-utils.tsx`:

```tsx
// Rendering helpers for the page tests.
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { config } from '@grafana/runtime';

/** element at url; with path, as the element of that route, so useParams works */
export function renderAt(element: React.ReactElement, url = '/', path?: string) {
  return render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {path ? (
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      ) : (
        element
      )}
    </MemoryRouter>
  );
}

/** the signed-in user's role, as canEdit() reads it */
export function asRole(orgRole: 'Viewer' | 'Editor' | 'Admin') {
  config.bootData.user = { orgRole, isGrafanaAdmin: false } as never;
}

/** a failed fetch as getBackendSrv rejects it */
export function fetchError(data: unknown, status = 422) {
  return { status, statusText: 'Error', data, config: {} };
}
```

`src/pages/Jobs.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { deleteJob, listJobs, listRuns, triggerJob, updateJob } from '../api';
import { aJob, aRun } from '../test-fixtures';
import { asRole, fetchError, renderAt } from '../test-utils';
import { jobToSpec } from '../utils';
import { Jobs } from './Jobs';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PluginPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listJobs: jest.fn(),
  listRuns: jest.fn(),
  triggerJob: jest.fn(),
  updateJob: jest.fn(),
  deleteJob: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

describe('Jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(listJobs).mockResolvedValue([aJob()]);
    mocked(listRuns).mockResolvedValue([aRun({ state: 'failed' })]);
    asRole('Editor');
  });

  it('shows each job with its schedule, next run and newest run', async () => {
    renderAt(<Jobs />);

    expect(await screen.findByText('collect')).toBeInTheDocument();
    expect(screen.getByText('0 * * * *')).toBeInTheDocument();
    expect(screen.getByText('2026-10-09 11:00:00')).toBeInTheDocument();
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.getByText('2026-10-09 00:00 → 01:00')).toBeInTheDocument();
    expect(listRuns).toHaveBeenCalledWith({ job: 'collect', size: 1 });
  });

  it('shows a Viewer the jobs and their runs, no actions', async () => {
    asRole('Viewer');
    renderAt(<Jobs />);

    expect(await screen.findByText('collect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      '/a/ocs-dockerjobs-app/runs?job=collect'
    );
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new job/i })).not.toBeInTheDocument();
  });

  it('disables a job by sending its whole definition back, enabled off', async () => {
    mocked(updateJob).mockResolvedValue(aJob({ enabled: false }));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(updateJob).toHaveBeenCalledWith('collect', { ...jobToSpec(aJob()), enabled: false }));
    expect(await screen.findByText('collect disabled')).toBeInTheDocument();
  });

  it('asks before running a job now, then says which run was queued', async () => {
    mocked(triggerJob).mockResolvedValue(aRun({ id: 12, state: 'queued' }));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(triggerJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith('collect'));
    expect(await screen.findByText('Run 12 of collect queued: 2026-10-09 00:00 → 01:00')).toBeInTheDocument();
  });

  it('deletes a job only once confirmed', async () => {
    mocked(deleteJob).mockResolvedValue(undefined);
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete collect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith('collect'));
  });

  it('says why the jobs cannot be loaded', async () => {
    mocked(listJobs).mockRejectedValue(fetchError({ message: 'plugin route match not found' }, 404));
    renderAt(<Jobs />);

    expect(await screen.findByText('plugin route match not found')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:ci`
Expected: `Jobs.test.tsx` fails with `Cannot find module './Jobs'`.

- [ ] **Step 3: Write the page and route it**

`src/pages/Jobs.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  ConfirmModal,
  InlineField,
  InlineSwitch,
  InteractiveTable,
  LinkButton,
  Stack,
  TextLink,
} from '@grafana/ui';

import { Job, Run, deleteJob, errorMessage, listJobs, listRuns, triggerJob, updateJob } from '../api';
import { ROUTES, prefixRoute } from '../constants';
import { canEdit, formatDate, formatInterval, jobToSpec, stateColor } from '../utils';

const REFRESH_MS = 15000;

/** A job and its newest run, if it has one. */
type Row = Job & { lastRun?: Run };

type Cell = CellProps<Row>;

type Pending = { action: 'run' | 'delete'; job: Row };

export const editRoute = (name: string) => prefixRoute(`${ROUTES.Jobs}/${encodeURIComponent(name)}/edit`);
export const runsRoute = (name: string) => `${prefixRoute(ROUTES.Runs)}?job=${encodeURIComponent(name)}`;

/** Every job, its schedule and its newest run; for Editors, the actions on it. */
export function Jobs() {
  const editable = canEdit();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pending, setPending] = useState<Pending>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const jobs = await listJobs();
      // one small request per job: its newest run
      const lastRuns = await Promise.all(
        jobs.map((job) =>
          listRuns({ job: job.name, size: 1 })
            .then((runs) => runs[0])
            .catch(() => undefined)
        )
      );
      setRows(jobs.map((job, index) => ({ ...job, lastRun: lastRuns[index] })));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!autoRefresh) {
      return undefined;
    }
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, autoRefresh]);

  const act = useCallback(
    async (what: () => Promise<string>) => {
      try {
        setNotice(await what());
        setError(undefined);
      } catch (err) {
        setError(errorMessage(err));
      }
      load();
    },
    [load]
  );

  const toggle = useCallback(
    (job: Row) =>
      act(async () => {
        await updateJob(job.name, { ...jobToSpec(job), enabled: !job.enabled });
        return `${job.name} ${job.enabled ? 'disabled' : 'enabled'}`;
      }),
    [act]
  );

  const confirm = () => {
    if (!pending) {
      return;
    }
    const { action, job } = pending;
    setPending(undefined);
    act(async () => {
      if (action === 'delete') {
        await deleteJob(job.name);
        return `${job.name} deleted, with its runs`;
      }
      const run = await triggerJob(job.name);
      return `Run ${run.id} of ${job.name} queued: ${formatInterval(run.data_interval_start, run.data_interval_end)}`;
    });
  };

  const columns = useMemo<Array<Column<Row>>>(
    () => [
      {
        id: 'name',
        header: 'Job',
        cell: ({ row }: Cell) =>
          editable ? (
            <TextLink href={editRoute(row.original.name)} inline={false}>
              {row.original.name}
            </TextLink>
          ) : (
            row.original.name
          ),
      },
      { id: 'schedule', header: 'Schedule (UTC)', cell: ({ row }: Cell) => <code>{row.original.schedule}</code> },
      {
        id: 'enabled',
        header: 'Status',
        cell: ({ row }: Cell) =>
          row.original.enabled ? <Badge text="enabled" color="green" /> : <Badge text="disabled" color="darkgrey" />,
      },
      { id: 'next_fire_at', header: 'Next run (UTC)', cell: ({ row }: Cell) => formatDate(row.original.next_fire_at) },
      {
        id: 'last_run',
        header: 'Last run',
        cell: ({ row }: Cell) => {
          const run = row.original.lastRun;
          return run ? (
            <Stack gap={1} alignItems="center">
              <Badge text={run.state} color={stateColor(run.state)} />
              {formatInterval(run.data_interval_start, run.data_interval_end)}
            </Stack>
          ) : (
            '–'
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }: Cell) => (
          <Stack gap={1} justifyContent="flex-end">
            <LinkButton size="sm" variant="secondary" href={runsRoute(row.original.name)}>
              Runs
            </LinkButton>
            {editable && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!row.original.enabled}
                  onClick={() => setPending({ action: 'run', job: row.original })}
                >
                  Run now
                </Button>
                <Button size="sm" variant="secondary" onClick={() => toggle(row.original)}>
                  {row.original.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  fill="text"
                  icon="trash-alt"
                  aria-label={`Delete ${row.original.name}`}
                  onClick={() => setPending({ action: 'delete', job: row.original })}
                />
              </>
            )}
          </Stack>
        ),
      },
    ],
    [editable, toggle]
  );

  return (
    <PluginPage>
      <Stack direction="column" gap={2}>
        <Stack justifyContent="space-between" wrap="wrap">
          <Stack gap={2} alignItems="center">
            <InlineField label="Auto refresh">
              <InlineSwitch value={autoRefresh} onChange={(event) => setAutoRefresh(event.currentTarget.checked)} />
            </InlineField>
            <Button variant="secondary" icon={loading ? 'spinner' : 'sync'} onClick={load}>
              Refresh
            </Button>
          </Stack>
          {editable && (
            <LinkButton href={prefixRoute(`${ROUTES.Jobs}/new`)} icon="plus">
              New job
            </LinkButton>
          )}
        </Stack>

        {error && (
          <Alert severity="error" title="Docker jobs" onRemove={() => setError(undefined)}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" title="Done" onRemove={() => setNotice(undefined)}>
            {notice}
          </Alert>
        )}

        <InteractiveTable columns={columns} data={rows} getRowId={(row: Row) => row.name} pageSize={50} />
      </Stack>

      <ConfirmModal
        isOpen={pending !== undefined}
        title={pending?.action === 'delete' ? `Delete ${pending.job.name}?` : `Run ${pending?.job.name} now?`}
        body={
          pending?.action === 'delete'
            ? 'The job and every run of it are deleted. Its logs stay in Loki.'
            : 'A manual run of its latest ended interval, recorded under your name.'
        }
        confirmText={pending?.action === 'delete' ? 'Delete' : 'Run'}
        onConfirm={confirm}
        onDismiss={() => setPending(undefined)}
      />
    </PluginPage>
  );
}

export default Jobs;
```

`src/components/App/App.tsx`:

```tsx
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { Alert } from '@grafana/ui';

import { AppSettings, type AppJsonData } from '../../settings';

const Jobs = React.lazy(() => import('../../pages/Jobs'));

function App({ meta }: AppRootProps<AppJsonData>) {
  if (!meta.jsonData?.backendUrl) {
    return (
      <Alert severity="warning" title="docker-jobs-backend is not configured">
        An administrator has to set its URL on the app&apos;s configuration page (Administration → Plugins → Docker
        Jobs).
      </Alert>
    );
  }

  return (
    <AppSettings.Provider value={meta.jsonData}>
      <Routes>
        {/* Default page */}
        <Route path="*" element={<Jobs />} />
      </Routes>
    </AppSettings.Provider>
  );
}

export default App;
```

- [ ] **Step 4: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint && npm run build`
Expected: `Tests: 35 passed, 35 total`, clean, built.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Jobs.tsx src/pages/Jobs.test.tsx src/test-utils.tsx src/components/App/App.tsx
git commit -m "feat: Jobs page with run now, enable/disable and delete" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Job editor

**Files:**
- Create: `src/pages/JobEditor.tsx`
- Modify: `src/components/App/App.tsx` (replace it with the version below)
- Test: `src/pages/JobEditor.test.tsx`

**Interfaces:**
- Consumes:
  - `createJob`, `getJob`, `previewJob`, `updateJob`, `errorMessage` and the types (Task 2);
  - `emptyJob`, `formatDate`, `formatInterval`, `jobToSpec` (Task 2);
  - the editors (Task 3);
  - `renderAt` and `fetchError` (Task 4).
- Produces:
  - `JobEditor`, routed at `jobs/new` and `jobs/:name/edit`.
  - Field ids: `job-name`, `job-description`, `job-image`, `job-enabled`, `job-schedule`, `job-start-date`, `job-end-date`, `job-catchup`, `job-max-active-runs`, `job-entrypoint-override`, `job-retries`, `job-retry-delay`, `job-timeout`, `job-cpu-limit`, `job-memory-limit`.

- [ ] **Step 1: Write the failing tests**

`src/pages/JobEditor.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { createJob, getJob, previewJob, updateJob } from '../api';
import { aJob } from '../test-fixtures';
import { fetchError, renderAt } from '../test-utils';
import { jobToSpec } from '../utils';
import { JobEditor } from './JobEditor';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PluginPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  createJob: jest.fn(),
  getJob: jest.fn(),
  previewJob: jest.fn(),
  updateJob: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

function fillNewJob() {
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'collect' } });
  fireEvent.change(screen.getByLabelText(/^image/i), { target: { value: 'maas-collector:3.10.1' } });
  fireEvent.change(screen.getByLabelText('Paste a command line into arguments'), {
    target: { value: 'maas_collector.rawdata.cli.odata --replay-start-date {{ data_interval_start | iso_ms }}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split into arguments' }));
}

describe('JobEditor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a job from the form, one argument per row', async () => {
    mocked(createJob).mockResolvedValue(aJob());
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fillNewJob();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createJob).toHaveBeenCalled());
    expect(mocked(createJob).mock.calls[0][0]).toMatchObject({
      name: 'collect',
      image: 'maas-collector:3.10.1',
      schedule: '0 * * * *',
      entrypoint: null,
      command: ['maas_collector.rawdata.cli.odata', '--replay-start-date', '{{ data_interval_start | iso_ms }}'],
      catchup: true,
    });
  });

  it('keeps the form as typed and says what the backend refused', async () => {
    mocked(createJob).mockRejectedValue(
      fetchError({ detail: [{ loc: ['body'], msg: "Value error, template command[2]: 'x' is undefined" }] })
    );
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fillNewJob();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Value error, template command[2]: 'x' is undefined")).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toHaveValue('collect');
  });

  it('cannot save a name the backend would refuse', () => {
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Collect_Hourly' } });
    fireEvent.change(screen.getByLabelText(/^image/i), { target: { value: 'img:1' } });

    expect(screen.getByText('Not a valid job name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits a job: loads it, keeps its name, PUTs its definition', async () => {
    mocked(getJob).mockResolvedValue(aJob());
    mocked(updateJob).mockResolvedValue(aJob({ image: 'maas-collector:3.11.0' }));
    renderAt(<JobEditor />, '/jobs/collect/edit', '/jobs/:name/edit');

    const image = await screen.findByLabelText(/^image/i);
    expect(screen.getByLabelText(/^name/i)).toBeDisabled();
    fireEvent.change(image, { target: { value: 'maas-collector:3.11.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateJob).toHaveBeenCalledWith('collect', { ...jobToSpec(aJob()), image: 'maas-collector:3.11.0' })
    );
  });

  it('previews the rendered command and what a launch would miss', async () => {
    mocked(previewJob).mockResolvedValue({
      data_interval_start: '2026-10-09T00:00:00Z',
      data_interval_end: '2026-10-09T01:00:00Z',
      entrypoint: null,
      command: ['--start', '2026-10-09T00:00:00.000Z'],
      env: {},
      next_fire_times: ['2026-10-09T11:00:00Z'],
      problems: ["secret 'cdse' does not exist"],
    });
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fillNewJob();
    fireEvent.change(screen.getByLabelText('Preview for the interval of'), {
      target: { value: '2026-10-09T00:30:00Z' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText("secret 'cdse' does not exist")).toBeInTheDocument();
    expect(screen.getByText('command: ["--start","2026-10-09T00:00:00.000Z"]')).toBeInTheDocument();
    expect(mocked(previewJob).mock.calls[0][1]).toBe('2026-10-09T00:30:00Z');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:ci`
Expected: `JobEditor.test.tsx` fails with `Cannot find module './JobEditor'`.

- [ ] **Step 3: Write the editor and route it**

`src/pages/JobEditor.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Button,
  Field,
  FieldSet,
  Input,
  LinkButton,
  LoadingPlaceholder,
  Stack,
  Switch,
  TagsInput,
  TextArea,
} from '@grafana/ui';

import {
  ConfigRef,
  JobCreate,
  MountSpec,
  Preview,
  SecretRef,
  createJob,
  errorMessage,
  getJob,
  previewJob,
  updateJob,
} from '../api';
import { KeyValueEditor } from '../components/editors/KeyValueEditor';
import { RowsEditor, RowField } from '../components/editors/RowsEditor';
import { StringListEditor } from '../components/editors/StringListEditor';
import { ROUTES, prefixRoute } from '../constants';
import { emptyJob, formatDate, formatInterval, jobToSpec } from '../utils';

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

const SECRET_FIELDS: Array<RowField<SecretRef>> = [
  { key: 'source', label: 'secret', placeholder: 'swarm secret name', width: 40 },
  { key: 'target', label: 'file', placeholder: '/run/secrets/<file>, the name if empty', width: 40 },
];
const CONFIG_FIELDS: Array<RowField<ConfigRef>> = [
  { key: 'source', label: 'config', placeholder: 'swarm config name', width: 40 },
  { key: 'target', label: 'path', placeholder: '/conf/collector/odata.json', width: 40 },
];
const MOUNT_FIELDS: Array<RowField<MountSpec>> = [
  { key: 'type', label: 'type', kind: 'choice', choices: ['volume', 'tmpfs', 'bind'] },
  { key: 'source', label: 'source', placeholder: 'volume name', width: 30 },
  { key: 'target', label: 'target', placeholder: '/work', width: 30 },
  { key: 'read_only', label: 'read only', kind: 'bool' },
];

const newSecret = (): SecretRef => ({ source: '', target: '', uid: '10001', gid: '10001', mode: 0o400 });
const newConfig = (): ConfigRef => ({ source: '', target: '', uid: '10001', gid: '10001', mode: 0o444 });
const newMount = (): MountSpec => ({ type: 'volume', source: '', target: '', read_only: false });

/** "" for nothing, the number otherwise: optional numeric fields. */
const optionalNumber = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/**
 * Create a job (/jobs/new) or change one (/jobs/:name/edit). Preview renders
 * the command for an interval and lists the swarm objects that would be
 * missing; Save sends the definition, and the backend's checks come back
 * as the error above the form, the form kept as typed.
 */
export function JobEditor() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<JobCreate | undefined>(name ? undefined : emptyJob());
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [previewDate, setPreviewDate] = useState('');

  useEffect(() => {
    if (!name) {
      return;
    }
    getJob(name)
      .then((job) => setForm({ ...jobToSpec(job), name: job.name }))
      .catch((err) => setError(errorMessage(err)));
  }, [name]);

  if (!form) {
    return (
      <PluginPage>
        {error ? <Alert title="Cannot load the job">{error}</Alert> : <LoadingPlaceholder text="Loading..." />}
      </PluginPage>
    );
  }

  const set = <K extends keyof JobCreate>(key: K, value: JobCreate[K]) => setForm({ ...form, [key]: value });
  const nameIsValid = NAME_PATTERN.test(form.name);
  const savable = nameIsValid && form.image.trim() !== '' && form.schedule.trim() !== '';

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      if (name) {
        const { name: _name, ...spec } = form;
        await updateJob(name, spec);
      } else {
        await createJob(form);
      }
      navigate(prefixRoute(ROUTES.Jobs));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setError(undefined);
    try {
      setPreview(await previewJob(form, previewDate.trim() || undefined));
    } catch (err) {
      setPreview(undefined);
      setError(errorMessage(err));
    }
  };

  return (
    <PluginPage>
      <Stack direction="column" gap={2}>
        {error && (
          <Alert severity="error" title={name ? `Cannot save ${name}` : 'Cannot save the job'}>
            {error}
          </Alert>
        )}

        <FieldSet label="Job">
          <Field
            label="Name"
            description="Lowercase letters, digits and inner dashes, 32 at most; it cannot change later"
            invalid={form.name !== '' && !nameIsValid}
            error="Not a valid job name"
          >
            <Input
              id="job-name"
              width={40}
              value={form.name}
              disabled={Boolean(name)}
              onChange={(event) => set('name', event.currentTarget.value)}
            />
          </Field>
          <Field label="Description">
            <TextArea
              id="job-description"
              rows={2}
              value={form.description}
              onChange={(event) => set('description', event.currentTarget.value)}
            />
          </Field>
          <Field label="Image" description="An immutable tag: each attempt pulls it when it starts">
            <Input
              id="job-image"
              value={form.image}
              placeholder="127.0.0.1:8085/maas-collector:3.10.1"
              onChange={(event) => set('image', event.currentTarget.value)}
            />
          </Field>
          <Field label="Enabled" description="A disabled job creates no runs and starts none">
            <Switch
              id="job-enabled"
              value={form.enabled}
              onChange={(event) => set('enabled', event.currentTarget.checked)}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Schedule">
          <Field
            label="Cron (UTC)"
            description="5 fields. The run for an interval starts when it ends: 0 * * * * at 01:00 covers 00:00 → 01:00"
          >
            <Input
              id="job-schedule"
              width={40}
              value={form.schedule}
              onChange={(event) => set('schedule', event.currentTarget.value)}
            />
          </Field>
          <Field label="Start date" description="ISO 8601 with a timezone; empty: the current interval">
            <Input
              id="job-start-date"
              width={40}
              placeholder="2026-10-09T00:00:00Z"
              value={form.start_date ?? ''}
              onChange={(event) => set('start_date', event.currentTarget.value.trim() || null)}
            />
          </Field>
          <Field label="End date" description="Optional: no interval ends after it">
            <Input
              id="job-end-date"
              width={40}
              value={form.end_date ?? ''}
              onChange={(event) => set('end_date', event.currentTarget.value.trim() || null)}
            />
          </Field>
          <Field label="Catch up" description="Run every missed interval after an outage; off: only the latest">
            <Switch
              id="job-catchup"
              value={form.catchup}
              onChange={(event) => set('catchup', event.currentTarget.checked)}
            />
          </Field>
          <Field label="Runs at once" description="1: never overlap">
            <Input
              id="job-max-active-runs"
              type="number"
              width={10}
              value={form.max_active_runs}
              onChange={(event) => set('max_active_runs', Number(event.currentTarget.value))}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Command">
          <Field
            label="Override the entrypoint"
            description="Off: the image's ENTRYPOINT. On: these arguments replace it"
          >
            <Switch
              id="job-entrypoint-override"
              value={form.entrypoint !== null}
              onChange={(event) => set('entrypoint', event.currentTarget.checked ? [] : null)}
            />
          </Field>
          {form.entrypoint !== null && (
            <StringListEditor
              label="entrypoint argument"
              value={form.entrypoint}
              onChange={(entrypoint) => set('entrypoint', entrypoint)}
              paste
            />
          )}
          <Field
            label="Command"
            description="One argument per row, no shell. Templates: {{ data_interval_start | iso_ms }}, {{ params.x }}, ..."
          >
            <StringListEditor
              label="argument"
              value={form.command}
              onChange={(command) => set('command', command)}
              paste
            />
          </Field>
          <Field label="Environment" description="Values are templates too">
            <KeyValueEditor label="variable" value={form.env} onChange={(env) => set('env', env)} />
          </Field>
          <Field label="Params" description="{{ params.<name> }} in the templates">
            <KeyValueEditor label="param" value={form.params} onChange={(params) => set('params', params)} />
          </Field>
        </FieldSet>

        <FieldSet label="Retries and limits">
          <Field label="Retries" description="Tries after the first failure">
            <Input
              id="job-retries"
              type="number"
              width={10}
              value={form.retries}
              onChange={(event) => set('retries', Number(event.currentTarget.value))}
            />
          </Field>
          <Field label="Retry delay (s)">
            <Input
              id="job-retry-delay"
              type="number"
              width={10}
              value={form.retry_delay_seconds}
              onChange={(event) => set('retry_delay_seconds', Number(event.currentTarget.value))}
            />
          </Field>
          <Field label="Timeout (s)" description="An attempt still running after this is stopped">
            <Input
              id="job-timeout"
              type="number"
              width={10}
              value={form.timeout_seconds}
              onChange={(event) => set('timeout_seconds', Number(event.currentTarget.value))}
            />
          </Field>
          <Field label="CPU limit" description="CPUs, e.g. 0.5; empty: none">
            <Input
              id="job-cpu-limit"
              type="number"
              width={10}
              value={form.cpu_limit ?? ''}
              onChange={(event) => set('cpu_limit', optionalNumber(event.currentTarget.value))}
            />
          </Field>
          <Field label="Memory limit (MB)" description="Empty: none">
            <Input
              id="job-memory-limit"
              type="number"
              width={10}
              value={form.memory_limit_mb ?? ''}
              onChange={(event) => set('memory_limit_mb', optionalNumber(event.currentTarget.value))}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Swarm">
          <Field label="Networks" description="Overlay networks, by name: a stack's are <stack>_<network>">
            <TagsInput tags={form.networks} onChange={(networks) => set('networks', networks)} />
          </Field>
          <Field label="Placement constraints" description="e.g. node.labels.role == maas">
            <TagsInput tags={form.constraints} onChange={(constraints) => set('constraints', constraints)} />
          </Field>
          <Field label="Secrets" description="Mounted read-only for uid 10001">
            <RowsEditor
              label="secret"
              rows={form.secrets}
              fields={SECRET_FIELDS}
              empty={newSecret}
              onChange={(secrets) => set('secrets', secrets)}
            />
          </Field>
          <Field label="Configs">
            <RowsEditor
              label="config"
              rows={form.configs}
              fields={CONFIG_FIELDS}
              empty={newConfig}
              onChange={(configs) => set('configs', configs)}
            />
          </Field>
          <Field label="Mounts" description="Bind mounts only where the backend allows them">
            <RowsEditor
              label="mount"
              rows={form.mounts}
              fields={MOUNT_FIELDS}
              empty={newMount}
              onChange={(mounts) => set('mounts', mounts)}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Preview">
          <Stack gap={1} alignItems="center">
            <Input
              aria-label="Preview for the interval of"
              width={40}
              placeholder="a date in the interval; empty: the latest ended"
              value={previewDate}
              onChange={(event) => setPreviewDate(event.currentTarget.value)}
            />
            <Button variant="secondary" icon="eye" disabled={!savable} onClick={runPreview}>
              Preview
            </Button>
          </Stack>
          {preview && <PreviewResult preview={preview} />}
        </FieldSet>

        <Stack gap={1}>
          <Button disabled={!savable || saving} icon={saving ? 'spinner' : 'save'} onClick={save}>
            Save
          </Button>
          <LinkButton variant="secondary" href={prefixRoute(ROUTES.Jobs)}>
            Cancel
          </LinkButton>
        </Stack>
      </Stack>
    </PluginPage>
  );
}

function PreviewResult({ preview }: { preview: Preview }) {
  return (
    <Stack direction="column" gap={1}>
      {preview.problems.length > 0 && (
        <Alert severity="warning" title="A launch would fail">
          <ul>
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div>Interval: {formatInterval(preview.data_interval_start, preview.data_interval_end)}</div>
      {preview.entrypoint && <pre>entrypoint: {JSON.stringify(preview.entrypoint)}</pre>}
      <pre>command: {JSON.stringify(preview.command)}</pre>
      {Object.keys(preview.env).length > 0 && <pre>env: {JSON.stringify(preview.env, null, 1)}</pre>}
      <div>Next runs (UTC): {preview.next_fire_times.map(formatDate).join(', ')}</div>
    </Stack>
  );
}

export default JobEditor;
```

`src/components/App/App.tsx`:

```tsx
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { Alert } from '@grafana/ui';

import { ROUTES } from '../../constants';
import { AppSettings, type AppJsonData } from '../../settings';

const Jobs = React.lazy(() => import('../../pages/Jobs'));
const JobEditor = React.lazy(() => import('../../pages/JobEditor'));

function App({ meta }: AppRootProps<AppJsonData>) {
  if (!meta.jsonData?.backendUrl) {
    return (
      <Alert severity="warning" title="docker-jobs-backend is not configured">
        An administrator has to set its URL on the app&apos;s configuration page (Administration → Plugins → Docker
        Jobs).
      </Alert>
    );
  }

  return (
    <AppSettings.Provider value={meta.jsonData}>
      <Routes>
        <Route path={`${ROUTES.Jobs}/new`} element={<JobEditor />} />
        <Route path={`${ROUTES.Jobs}/:name/edit`} element={<JobEditor />} />
        {/* Default page */}
        <Route path="*" element={<Jobs />} />
      </Routes>
    </AppSettings.Provider>
  );
}

export default App;
```

- [ ] **Step 4: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint && npm run build`
Expected: `Tests: 40 passed, 40 total`, clean, built.

- [ ] **Step 5: Commit**

```bash
git add src/pages/JobEditor.tsx src/pages/JobEditor.test.tsx src/components/App/App.tsx
git commit -m "feat: job editor with preview" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Runs, run details, rerun and cancel

**Files:**
- Create: `src/pages/Runs.tsx`, `src/pages/RunDetails.tsx`
- Modify: `jest-setup.js` (append), `src/components/App/App.tsx` (replace it with the final version below)
- Test: `src/pages/Runs.test.tsx`, `src/pages/RunDetails.test.tsx`

**Interfaces:**
- Consumes:
  - `listJobs`, `listRuns`, `getRun`, `rerunRun`, `cancelRun`, `errorMessage` (Task 2);
  - `exploreUrl`, `isEnded`, `canEdit`, `formatDate`, `formatInterval`, `stateColor` (Task 2);
  - `useAppSettings` and `Truncated` (Task 1);
  - `renderAt` and `asRole` (Task 4).
- Produces:
  - `Runs` at `runs`, filters preselected by `?job=&state=`, with `PAGE_SIZE = 50`;
  - `RunDetails({ runId, onChanged? })`, the expanded row of the runs table;
  - `RunPage` at `runs/:id`.

- [ ] **Step 1: Write the failing tests**

`src/pages/Runs.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { listJobs, listRuns } from '../api';
import { aJob, aRun } from '../test-fixtures';
import { renderAt } from '../test-utils';
import { PAGE_SIZE, Runs } from './Runs';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PluginPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listJobs: jest.fn(),
  listRuns: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

describe('Runs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(listJobs).mockResolvedValue([aJob()]);
  });

  it('filters by the job and state in the URL', async () => {
    mocked(listRuns).mockResolvedValue([aRun({ state: 'failed' })]);
    renderAt(<Runs />, '/a/ocs-dockerjobs-app/runs?job=collect&state=failed');

    expect(await screen.findByText('2026-10-09 00:00 → 01:00')).toBeInTheDocument();
    expect(listRuns).toHaveBeenCalledWith({ job: 'collect', state: 'failed', offset: 0, size: PAGE_SIZE });
  });

  it('pages to older runs while pages are full', async () => {
    const page = Array.from({ length: PAGE_SIZE }, (_, i) => aRun({ id: i + 1 }));
    mocked(listRuns).mockResolvedValue(page);
    renderAt(<Runs />, '/a/ocs-dockerjobs-app/runs');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Older' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));

    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith({
        job: undefined,
        state: undefined,
        offset: PAGE_SIZE,
        size: PAGE_SIZE,
      })
    );
  });
});
```

`src/pages/RunDetails.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { cancelRun, getRun, rerunRun } from '../api';
import { AppSettings } from '../settings';
import { aRun, anAttempt } from '../test-fixtures';
import { asRole } from '../test-utils';
import { RunDetails } from './RunDetails';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getRun: jest.fn(),
  rerunRun: jest.fn(),
  cancelRun: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

function renderDetails(lokiDatasourceUid?: string, onChanged = jest.fn()) {
  render(
    <AppSettings.Provider value={{ backendUrl: 'http://b', lokiDatasourceUid }}>
      <RunDetails runId={7} onChanged={onChanged} />
    </AppSettings.Provider>
  );
  return onChanged;
}

describe('RunDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asRole('Editor');
  });

  it('shows the attempts and opens their logs in Explore', async () => {
    mocked(getRun).mockResolvedValue(aRun());
    renderDetails('loki-uid');

    const link = await screen.findByRole('link', { name: /logs/i });
    expect(link.getAttribute('href')).toContain('/explore?schemaVersion=1&panes=');
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('djobs_collect_7_1');
    expect(screen.getByText('["--start","2026-10-09T00:00:00.000Z"]')).toBeInTheDocument();
  });

  it('has no Logs link without a Loki datasource', async () => {
    mocked(getRun).mockResolvedValue(aRun());
    renderDetails(undefined);

    expect(await screen.findByText('node-1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /logs/i })).not.toBeInTheDocument();
  });

  it('reruns an ended run with a note, then tells the list', async () => {
    mocked(getRun).mockResolvedValue(aRun({ state: 'failed' }));
    mocked(rerunRun).mockResolvedValue(
      aRun({
        state: 'queued',
        attempts: [anAttempt({ state: 'failed' }), anAttempt({ try_number: 2, state: 'pending' })],
      })
    );
    const onChanged = renderDetails();

    fireEvent.click(await screen.findByRole('button', { name: 'Rerun' }));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'upstream fixed' } });
    const buttons = screen.getAllByRole('button', { name: 'Rerun' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(rerunRun).toHaveBeenCalledWith(7, 'upstream fixed'));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText('pending')).toBeInTheDocument();
  });

  it('cancels a run that has not ended', async () => {
    mocked(getRun).mockResolvedValue(aRun({ state: 'running', finished_at: null }));
    mocked(cancelRun).mockResolvedValue(aRun({ state: 'cancelled' }));
    renderDetails();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    const buttons = screen.getAllByRole('button', { name: 'Cancel run' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith(7, ''));
  });

  it('offers a Viewer neither rerun nor cancel', async () => {
    asRole('Viewer');
    mocked(getRun).mockResolvedValue(aRun({ state: 'failed' }));
    renderDetails();

    expect(await screen.findByText('node-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rerun' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:ci`
Expected: both suites fail with `Cannot find module './Runs'` and `'./RunDetails'`.

- [ ] **Step 3: Write the pages, the canvas stub, and the final routes**

Append to `jest-setup.js`. `@grafana/ui`'s `Combobox` measures text on a canvas, and the scaffold's setup stubs `getContext()` with nothing:

```js
// @grafana/ui's Combobox sizes itself with a canvas' measureText; the
// scaffolded setup stubs getContext() with nothing, so give it a context that
// measures something.
HTMLCanvasElement.prototype.getContext = () => ({ measureText: (text) => ({ width: String(text).length * 8 }) });
```

`src/pages/RunDetails.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  ConfirmModal,
  Field,
  Input,
  InteractiveTable,
  LoadingPlaceholder,
  Stack,
  TextLink,
  useStyles2,
} from '@grafana/ui';

import { Attempt, Run, cancelRun, errorMessage, getRun, rerunRun } from '../api';
import { Truncated } from '../components/Truncated/Truncated';
import { useAppSettings } from '../settings';
import { canEdit, exploreUrl, formatDate, formatInterval, isEnded, stateColor } from '../utils';

type Cell = CellProps<Attempt>;

interface Props {
  runId: number;
  /** after a rerun or a cancel, so a list showing the run can reload */
  onChanged?: () => void;
}

/** One run: its attempts, where their logs are, and -- for Editors -- rerun or cancel. */
export function RunDetails({ runId, onChanged }: Props) {
  const styles = useStyles2(getStyles);
  const { lokiDatasourceUid } = useAppSettings();
  const editable = canEdit();
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();
  const [action, setAction] = useState<'rerun' | 'cancel'>();
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setRun(await getRun(runId));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<Array<Column<Attempt>>>(
    () => [
      { id: 'try_number', header: 'Try' },
      { id: 'reason', header: 'Why' },
      {
        id: 'state',
        header: 'State',
        cell: ({ row }: Cell) => <Badge text={row.original.state} color={stateColor(row.original.state)} />,
      },
      { id: 'launched_at', header: 'Launched (UTC)', cell: ({ row }: Cell) => formatDate(row.original.launched_at) },
      { id: 'finished_at', header: 'Ended (UTC)', cell: ({ row }: Cell) => formatDate(row.original.finished_at) },
      { id: 'exit_code', header: 'Exit', cell: ({ row }: Cell) => row.original.exit_code ?? '–' },
      {
        id: 'node_id',
        header: 'Node',
        cell: ({ row }: Cell) => <Truncated text={row.original.node_id ?? ''} maxWidth={120} />,
      },
      {
        id: 'error',
        header: 'Error',
        cell: ({ row }: Cell) => <Truncated text={row.original.error ?? ''} maxWidth={320} />,
      },
      {
        id: 'logs',
        header: 'Logs',
        cell: ({ row }: Cell) =>
          lokiDatasourceUid && row.original.loki_selector ? (
            <TextLink
              href={exploreUrl(
                lokiDatasourceUid,
                row.original.loki_selector,
                row.original.launched_at,
                row.original.finished_at
              )}
              external
            >
              Logs
            </TextLink>
          ) : (
            '–'
          ),
      },
    ],
    [lokiDatasourceUid]
  );

  if (!run) {
    return error ? <Alert title="Cannot load the run">{error}</Alert> : <LoadingPlaceholder text="Loading..." />;
  }

  const confirm = async () => {
    const what = action;
    setAction(undefined);
    try {
      setRun(what === 'rerun' ? await rerunRun(run.id, note) : await cancelRun(run.id, note));
      setNote('');
      setError(undefined);
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const attempts = run.attempts ?? [];
  const last = attempts[attempts.length - 1];

  return (
    <div className={styles.details}>
      {error && (
        <Alert severity="error" title={`Run ${run.id}`} onRemove={() => setError(undefined)}>
          {error}
        </Alert>
      )}
      <dl>
        <dt>Run</dt>
        <dd>
          {run.id} of {run.job}, {run.run_type}
        </dd>
        <dt>Interval (UTC)</dt>
        <dd>{formatInterval(run.data_interval_start, run.data_interval_end)}</dd>
        <dt>State</dt>
        <dd>
          <Badge text={run.state} color={stateColor(run.state)} /> try {run.try_number} of {run.max_tries}
        </dd>
        {run.requested_by && (
          <>
            <dt>Asked by</dt>
            <dd>
              {run.requested_by}
              {run.note && `: ${run.note}`}
            </dd>
          </>
        )}
        {last?.rendered_command && (
          <>
            <dt>Command</dt>
            <dd>
              <code>{JSON.stringify([...(last.rendered_entrypoint ?? []), ...last.rendered_command])}</code>
            </dd>
          </>
        )}
      </dl>

      <InteractiveTable columns={columns} data={attempts} getRowId={(attempt: Attempt) => String(attempt.try_number)} />

      {editable && (
        <Stack gap={1}>
          {isEnded(run.state) ? (
            <Button size="sm" icon="history" onClick={() => setAction('rerun')}>
              Rerun
            </Button>
          ) : (
            <Button size="sm" variant="destructive" icon="times" onClick={() => setAction('cancel')}>
              Cancel run
            </Button>
          )}
        </Stack>
      )}

      <ConfirmModal
        isOpen={action !== undefined}
        title={action === 'rerun' ? `Rerun run ${run.id}?` : `Cancel run ${run.id}?`}
        body={
          <Stack direction="column" gap={1}>
            {action === 'rerun'
              ? `A new attempt of ${run.job} over the same interval, with the job's retries afresh.`
              : 'Its pending attempt is dropped, or its running service removed.'}
            <Field label="Note" description="Why: recorded with your name">
              <Input id="run-action-note" value={note} onChange={(event) => setNote(event.currentTarget.value)} />
            </Field>
          </Stack>
        }
        confirmText={action === 'rerun' ? 'Rerun' : 'Cancel run'}
        confirmVariant={action === 'rerun' ? 'primary' : 'destructive'}
        onConfirm={confirm}
        onDismiss={() => setAction(undefined)}
      />
    </div>
  );
}

/** /runs/:id, a run on its own page: what a link to one run opens. */
export function RunPage() {
  const { id } = useParams();
  return (
    <PluginPage>
      <RunDetails runId={Number(id)} />
    </PluginPage>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  details: css({
    padding: theme.spacing(1, 2),
    dl: {
      display: 'grid',
      gridTemplateColumns: 'max-content auto',
      columnGap: theme.spacing(2),
      rowGap: theme.spacing(0.5),
      marginBottom: theme.spacing(2),
    },
    dt: { color: theme.colors.text.secondary },
  }),
});

export default RunPage;
```

`src/pages/Runs.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  Combobox,
  ComboboxOption,
  InlineField,
  InlineSwitch,
  InteractiveTable,
  RadioButtonGroup,
  Stack,
} from '@grafana/ui';

import { Run, RunState, errorMessage, listJobs, listRuns } from '../api';
import { formatDate, formatInterval, stateColor } from '../utils';
import { RunDetails } from './RunDetails';

const REFRESH_MS = 15000;
export const PAGE_SIZE = 50;

const STATE_OPTIONS: Array<{ label: string; value: RunState | '' }> = [
  { label: 'All', value: '' },
  { label: 'Queued', value: 'queued' },
  { label: 'Running', value: 'running' },
  { label: 'Retrying', value: 'retrying' },
  { label: 'Success', value: 'success' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

type Cell = CellProps<Run>;

const columns: Array<Column<Run>> = [
  {
    id: 'interval',
    header: 'Interval (UTC)',
    cell: ({ row }: Cell) => formatInterval(row.original.data_interval_start, row.original.data_interval_end),
  },
  { id: 'job', header: 'Job' },
  { id: 'run_type', header: 'Type' },
  {
    id: 'state',
    header: 'State',
    cell: ({ row }: Cell) => <Badge text={row.original.state} color={stateColor(row.original.state)} />,
  },
  { id: 'try', header: 'Try', cell: ({ row }: Cell) => `${row.original.try_number}/${row.original.max_tries}` },
  { id: 'started_at', header: 'Started (UTC)', cell: ({ row }: Cell) => formatDate(row.original.started_at) },
  { id: 'finished_at', header: 'Ended (UTC)', cell: ({ row }: Cell) => formatDate(row.original.finished_at) },
  { id: 'requested_by', header: 'By', cell: ({ row }: Cell) => row.original.requested_by || '–' },
];

/** Runs, newest interval first; ?job=&state= preselects the filters. Expand a row for its attempts. */
export function Runs() {
  const location = useLocation();
  const initial = new URLSearchParams(location.search);
  const [job, setJob] = useState(initial.get('job') ?? '');
  const [state, setState] = useState<RunState | ''>((initial.get('state') as RunState | null) ?? '');
  const [offset, setOffset] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [jobNames, setJobNames] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await listRuns({ job: job || undefined, state: state || undefined, offset, size: PAGE_SIZE }));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [job, state, offset]);

  useEffect(() => {
    load();
    if (!autoRefresh) {
      return undefined;
    }
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, autoRefresh]);

  useEffect(() => {
    listJobs()
      .then((jobs) => setJobNames(jobs.map((item) => item.name)))
      .catch(() => setJobNames([]));
  }, []);

  const jobOptions = useMemo<Array<ComboboxOption<string>>>(
    () => [{ label: 'All jobs', value: '' }, ...jobNames.map((name) => ({ label: name, value: name }))],
    [jobNames]
  );

  return (
    <PluginPage>
      <Stack direction="column" gap={2}>
        <Stack gap={2} wrap="wrap" alignItems="center">
          <InlineField label="Job">
            <Combobox
              id="runs-job"
              width={30}
              options={jobOptions}
              value={job}
              onChange={(option) => {
                setJob(option.value);
                setOffset(0);
              }}
            />
          </InlineField>
          <InlineField label="State">
            <RadioButtonGroup
              options={STATE_OPTIONS}
              value={state}
              onChange={(value) => {
                setState(value);
                setOffset(0);
              }}
            />
          </InlineField>
          <InlineField label="Auto refresh">
            <InlineSwitch value={autoRefresh} onChange={(event) => setAutoRefresh(event.currentTarget.checked)} />
          </InlineField>
          <Button variant="secondary" icon={loading ? 'spinner' : 'sync'} onClick={load}>
            Refresh
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" title="Cannot load the runs">
            {error}
          </Alert>
        )}

        <InteractiveTable
          columns={columns}
          data={runs}
          getRowId={(run: Run) => String(run.id)}
          renderExpandedRow={(run: Run) => <RunDetails runId={run.id} onChanged={load} />}
        />

        <Stack gap={1} justifyContent="flex-end">
          <Button
            size="sm"
            variant="secondary"
            icon="angle-left"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Newer
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="angle-right"
            disabled={runs.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Older
          </Button>
        </Stack>
      </Stack>
    </PluginPage>
  );
}

export default Runs;
```

`src/components/App/App.tsx`:

```tsx
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { Alert } from '@grafana/ui';

import { ROUTES } from '../../constants';
import { AppSettings, type AppJsonData } from '../../settings';

const Jobs = React.lazy(() => import('../../pages/Jobs'));
const JobEditor = React.lazy(() => import('../../pages/JobEditor'));
const Runs = React.lazy(() => import('../../pages/Runs'));
const RunPage = React.lazy(() => import('../../pages/RunDetails'));

function App({ meta }: AppRootProps<AppJsonData>) {
  if (!meta.jsonData?.backendUrl) {
    return (
      <Alert severity="warning" title="docker-jobs-backend is not configured">
        An administrator has to set its URL on the app&apos;s configuration page (Administration → Plugins → Docker
        Jobs).
      </Alert>
    );
  }

  return (
    <AppSettings.Provider value={meta.jsonData}>
      <Routes>
        <Route path={`${ROUTES.Jobs}/new`} element={<JobEditor />} />
        <Route path={`${ROUTES.Jobs}/:name/edit`} element={<JobEditor />} />
        <Route path={ROUTES.Runs} element={<Runs />} />
        <Route path={`${ROUTES.Runs}/:id`} element={<RunPage />} />
        {/* Default page */}
        <Route path="*" element={<Jobs />} />
      </Routes>
    </AppSettings.Provider>
  );
}

export default App;
```

- [ ] **Step 4: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint && npm run build`
Expected: `Tests: 47 passed, 47 total`, no console warnings, clean, built.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Runs.tsx src/pages/RunDetails.tsx src/pages/Runs.test.tsx src/pages/RunDetails.test.tsx \
  jest-setup.js src/components/App/App.tsx
git commit -m "feat: runs and their attempts, logs in Explore, rerun and cancel" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Overview dashboard

**Files:**
- Create: `src/dashboards/overview.json`
- Modify: `src/plugin.json` (replace it with the version below, which adds the dashboard include)
- Test: `src/dashboards/overview.test.ts`

**Interfaces:**
- Consumes: the backend's metric names (`telemetry.py`), with or without Mimir's `_total`/`_seconds` suffixes.
- Produces:
  - dashboard uid `ocs-dockerjobs-overview`, titled "Docker jobs overview";
  - variables `datasource` (prometheus) and `job` (`docker_job`, multi);
  - it is imported when the app is enabled.

- [ ] **Step 1: Write the failing test**

`src/dashboards/overview.test.ts`:

```ts
import dashboard from './overview.json';

// docker-jobs-backend's metrics (src/docker_jobs_backend/telemetry.py there),
// as Mimir stores them: with otel_metric_suffixes_enabled a counter gets
// _total and a seconds unit _seconds; without, neither.
const COUNTERS = ['runs_created', 'runs_finished', 'attempts_started', 'attempts_finished', 'intervals_skipped'];
const GAUGES = ['job_gaps', 'runs_active', 'docker_up'];
const SECONDS_GAUGES = ['job_covered_until', 'scheduler_heartbeat'];
const SECONDS_HISTOGRAMS = ['attempt_duration'];

function names(suffixes: boolean): string[] {
  const seconds = suffixes ? '_seconds' : '';
  return [
    ...COUNTERS.map((name) => `docker_jobs_${name}${suffixes ? '_total' : ''}`),
    ...GAUGES.map((name) => `docker_jobs_${name}`),
    ...SECONDS_GAUGES.map((name) => `docker_jobs_${name}${seconds}`),
    ...SECONDS_HISTOGRAMS.flatMap((name) =>
      ['bucket', 'sum', 'count'].map((part) => `docker_jobs_${name}${seconds}_${part}`)
    ),
  ];
}

type Panel = { type: string; title: string; datasource?: { uid: string }; targets?: Array<{ expr: string }> };

const panels = dashboard.panels as Panel[];
const queried = panels.filter((panel) => panel.type !== 'row');

describe('the overview dashboard', () => {
  it.each([true, false])('finds every metric it queries, Mimir suffixes %s', (suffixes) => {
    const known = names(suffixes);

    for (const panel of queried) {
      for (const { expr } of panel.targets ?? []) {
        const regexes = Array.from(expr.matchAll(/__name__=~"([^"]+)"/g), (match) => new RegExp(`^${match[1]}$`));
        const plain = expr.replace(/__name__=~"[^"]+"/g, '').match(/docker_jobs_[a-z_]+/g) ?? [];

        for (const regex of regexes) {
          expect(known.some((name) => regex.test(name))).toBe(true);
        }
        for (const name of plain) {
          expect(known).toContain(name);
        }
        expect(regexes.length + plain.length).toBeGreaterThan(0);
      }
    }
  });

  it('queries the datasource picked in its variable, every panel', () => {
    for (const panel of queried) {
      expect(panel.datasource?.uid).toBe('${datasource}');
    }
  });

  it('keeps a stable uid, so a new version replaces the old one', () => {
    expect(dashboard.uid).toBe('ocs-dockerjobs-overview');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:ci`
Expected: `overview.test.ts` fails with `Cannot find module './overview.json'`.

- [ ] **Step 3: Write the dashboard and include it**

`src/dashboards/overview.json`:

```json
{
  "uid": "ocs-dockerjobs-overview",
  "title": "Docker jobs overview",
  "tags": [
    "docker-jobs"
  ],
  "timezone": "utc",
  "editable": true,
  "schemaVersion": 41,
  "version": 1,
  "refresh": "1m",
  "time": {
    "from": "now-24h",
    "to": "now"
  },
  "templating": {
    "list": [
      {
        "name": "datasource",
        "label": "Metrics",
        "type": "datasource",
        "query": "prometheus",
        "current": {},
        "hide": 0,
        "refresh": 1
      },
      {
        "name": "job",
        "label": "Job",
        "type": "query",
        "datasource": {
          "type": "prometheus",
          "uid": "${datasource}"
        },
        "query": {
          "query": "label_values(docker_jobs_job_gaps, docker_job)",
          "refId": "jobs"
        },
        "definition": "label_values(docker_jobs_job_gaps, docker_job)",
        "multi": true,
        "includeAll": true,
        "allValue": ".*",
        "current": {},
        "refresh": 2,
        "sort": 1,
        "hide": 0
      }
    ]
  },
  "annotations": {
    "list": []
  },
  "panels": [
    {
      "id": 1,
      "type": "row",
      "title": "Scheduler",
      "collapsed": false,
      "gridPos": {
        "h": 1,
        "w": 24,
        "x": 0,
        "y": 0
      },
      "panels": []
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Last tick",
      "description": "Seconds since the scheduler last completed a tick. Over 300: the 'scheduler down' alert fires.",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 0,
        "y": 1
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "time() - max({__name__=~\"docker_jobs_scheduler_heartbeat(_seconds)?\"})",
          "legendFormat": "__auto",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "colorMode": "background",
        "graphMode": "none",
        "textMode": "value"
      },
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "orange",
                "value": 60
              },
              {
                "color": "red",
                "value": 300
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "Docker reachable",
      "description": "Whether the last tick reached Docker through the socket-proxy.",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 6,
        "y": 1
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "max(docker_jobs_docker_up)",
          "legendFormat": "__auto",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "colorMode": "background",
        "graphMode": "none",
        "textMode": "value"
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none",
          "mappings": [
            {
              "type": "value",
              "options": {
                "0": {
                  "text": "no"
                },
                "1": {
                  "text": "yes"
                }
              }
            }
          ],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "green",
                "value": 1
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "Runs waiting",
      "description": "Runs created and not started: limits, or catch-up.",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 12,
        "y": 1
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "sum(docker_jobs_runs_active{state=\"queued\", docker_job=~\"$job\"})",
          "legendFormat": "__auto",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "colorMode": "background",
        "graphMode": "none",
        "textMode": "value"
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none",
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 5,
      "type": "stat",
      "title": "Runs running",
      "description": "",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 18,
        "y": 1
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "sum(docker_jobs_runs_active{state=\"running\", docker_job=~\"$job\"})",
          "legendFormat": "__auto",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "colorMode": "background",
        "graphMode": "none",
        "textMode": "value"
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none",
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 6,
      "type": "row",
      "title": "Jobs",
      "collapsed": false,
      "gridPos": {
        "h": 1,
        "w": 24,
        "x": 0,
        "y": 5
      },
      "panels": []
    },
    {
      "id": 7,
      "type": "bargauge",
      "title": "Missing intervals",
      "description": "Intervals that ended without data: failed, cancelled, not started, or not scheduled. Above 0 for 15 minutes, an alert fires.",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 8,
        "w": 8,
        "x": 0,
        "y": 6
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "max by (docker_job) (docker_jobs_job_gaps{docker_job=~\"$job\"})",
          "legendFormat": "{{docker_job}}",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "orientation": "horizontal",
        "displayMode": "basic",
        "showUnfilled": true,
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none",
          "min": 0,
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 1
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 8,
      "type": "bargauge",
      "title": "Failed runs, 24 h",
      "description": "Runs that failed once their retries ran out.",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 8,
        "w": 8,
        "x": 8,
        "y": 6
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "sum by (docker_job) (increase({__name__=~\"docker_jobs_runs_finished(_total)?\", state=\"failed\", docker_job=~\"$job\"}[24h]))",
          "legendFormat": "{{docker_job}}",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "orientation": "horizontal",
        "displayMode": "basic",
        "showUnfilled": true,
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none",
          "min": 0,
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 1
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 9,
      "type": "bargauge",
      "title": "Data covered until, hours ago",
      "description": "Hours since the end of the newest interval with a successful run.",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 8,
        "w": 8,
        "x": 16,
        "y": 6
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "(time() - max by (docker_job) ({__name__=~\"docker_jobs_job_covered_until(_seconds)?\", docker_job=~\"$job\"})) / 3600",
          "legendFormat": "{{docker_job}}",
          "range": false,
          "instant": true
        }
      ],
      "options": {
        "orientation": "horizontal",
        "displayMode": "basic",
        "showUnfilled": true,
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "h",
          "min": 0,
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "id": 10,
      "type": "timeseries",
      "title": "Attempts by outcome",
      "description": "",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 8,
        "w": 8,
        "x": 0,
        "y": 14
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "sum by (outcome) (increase({__name__=~\"docker_jobs_attempts_finished(_total)?\", docker_job=~\"$job\"}[$__rate_interval]))",
          "legendFormat": "{{outcome}}",
          "range": true,
          "instant": false
        }
      ],
      "options": {
        "legend": {
          "displayMode": "list",
          "placement": "bottom"
        },
        "tooltip": {
          "mode": "multi",
          "sort": "desc"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none"
        },
        "overrides": []
      }
    },
    {
      "id": 11,
      "type": "timeseries",
      "title": "Attempt duration, p95",
      "description": "",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 8,
        "w": 8,
        "x": 8,
        "y": 14
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "histogram_quantile(0.95, sum by (le, docker_job) (rate({__name__=~\"docker_jobs_attempt_duration(_seconds)?_bucket\", docker_job=~\"$job\"}[$__rate_interval])))",
          "legendFormat": "{{docker_job}}",
          "range": true,
          "instant": false
        }
      ],
      "options": {
        "legend": {
          "displayMode": "list",
          "placement": "bottom"
        },
        "tooltip": {
          "mode": "multi",
          "sort": "desc"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "s"
        },
        "overrides": []
      }
    },
    {
      "id": 12,
      "type": "timeseries",
      "title": "Runs created",
      "description": "",
      "datasource": {
        "type": "prometheus",
        "uid": "${datasource}"
      },
      "gridPos": {
        "h": 8,
        "w": 8,
        "x": 16,
        "y": 14
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "${datasource}"
          },
          "expr": "sum by (run_type) (increase({__name__=~\"docker_jobs_runs_created(_total)?\", docker_job=~\"$job\"}[$__rate_interval]))",
          "legendFormat": "{{run_type}}",
          "range": true,
          "instant": false
        }
      ],
      "options": {
        "legend": {
          "displayMode": "list",
          "placement": "bottom"
        },
        "tooltip": {
          "mode": "multi",
          "sort": "desc"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "none"
        },
        "overrides": []
      }
    }
  ]
}
```

`src/plugin.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/grafana/grafana/main/docs/sources/developers/plugins/plugin.schema.json",
  "type": "app",
  "name": "Docker Jobs",
  "id": "ocs-dockerjobs-app",
  "backend": false,
  "info": {
    "keywords": ["app", "docker", "swarm", "cron", "jobs"],
    "description": "Scheduled jobs on Docker Swarm: define them, follow their runs, rerun or cancel them",
    "author": {
      "name": "Serco - Space unit"
    },
    "logos": {
      "small": "img/logo.svg",
      "large": "img/logo.svg"
    },
    "screenshots": [],
    "version": "%VERSION%",
    "updated": "%TODAY%"
  },
  "routes": [
    {
      "path": "api/*",
      "method": "GET",
      "reqRole": "Viewer",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    },
    {
      "path": "api/*",
      "method": "POST",
      "reqRole": "Editor",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    },
    {
      "path": "api/*",
      "method": "PUT",
      "reqRole": "Editor",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    },
    {
      "path": "api/*",
      "method": "DELETE",
      "reqRole": "Editor",
      "url": "{{ .JsonData.backendUrl }}/api",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiToken }}" }]
    }
  ],
  "includes": [
    {
      "type": "page",
      "name": "Jobs",
      "path": "/a/%PLUGIN_ID%/jobs",
      "role": "Viewer",
      "addToNav": true,
      "defaultNav": true
    },
    {
      "type": "page",
      "name": "Runs",
      "path": "/a/%PLUGIN_ID%/runs",
      "role": "Viewer",
      "addToNav": true,
      "defaultNav": false
    },
    {
      "type": "dashboard",
      "name": "Docker jobs overview",
      "path": "dashboards/overview.json",
      "role": "Viewer",
      "addToNav": true
    },
    {
      "type": "page",
      "icon": "cog",
      "name": "Configuration",
      "path": "/plugins/%PLUGIN_ID%",
      "role": "Admin",
      "addToNav": true
    }
  ],
  "dependencies": {
    "grafanaDependency": ">=13.2.0",
    "plugins": []
  }
}
```

- [ ] **Step 4: Run everything green**

Run: `npm run test:ci && npm run typecheck && npm run lint && npm run build && ls dist/dashboards`
Expected: `Tests: 51 passed, 51 total`, clean, built, and `overview.json` listed.

- [ ] **Step 5: Commit**

```bash
git add src/dashboards src/plugin.json
git commit -m "feat: bundled overview dashboard of the jobs' metrics" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Packaging, delivery image, local Grafana, CI, README

**Files:**
- Create: `scripts/package.sh`, `Dockerfile`, `.dockerignore`, `docker/nginx.conf`, `docker-compose.yaml`, `provisioning/plugins/apps.yaml`, `provisioning/datasources/loki.yaml`, `.github/workflows/docker-jobs-app.yml`
- Modify: `README.md` (write it in full)

**Interfaces:**
- Consumes: `npm run build` (Tasks 1–7).
- Produces:
  - `ocs-dockerjobs-app-<version>.zip` (+ `.sha256`), whose single top-level directory is `ocs-dockerjobs-app/`;
  - the image `docker-jobs-app`, nginx on 8080 serving `/ocs-dockerjobs-app-<version>.zip`, `/ocs-dockerjobs-app.zip` and `/health`.

- [ ] **Step 1: Write the packaging script and the image**

`scripts/package.sh` (then `chmod +x scripts/package.sh`):

```bash
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
```

`docker/nginx.conf`:

```nginx
# Serves the packaged plugin to Grafana: GET /ocs-dockerjobs-app-<version>.zip,
# /ocs-dockerjobs-app.zip for "whatever this image carries", and /health.
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    autoindex on;

    location = /health {
        access_log off;
        default_type text/plain;
        return 200 "ok\n";
    }

    location ~ \.zip$ {
        default_type application/zip;
    }
}
```

`.dockerignore`:

```gitignore
.git/
node_modules/
dist/
coverage/
*.zip
*.zip.sha256
.eslintcache
```

`Dockerfile`:

```dockerfile
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
```

- [ ] **Step 2: Package, and check the zip**

```bash
./scripts/package.sh
unzip -l ocs-dockerjobs-app-0.1.0.zip | awk '{print $4}' | grep -E '^ocs-dockerjobs-app/(plugin.json|module.js|dashboards/overview.json)$'
```

Expected: `Packaged ocs-dockerjobs-app-0.1.0.zip`, then the three paths. The zip is gitignored.

- [ ] **Step 3: Build and probe the image**

```bash
DOCKER_CONTEXT=default docker build -t docker-jobs-app:dev .
DOCKER_CONTEXT=default docker run -d --rm --name djapp-smoke -p 18080:8080 docker-jobs-app:dev
sleep 2
curl -fsS localhost:18080/health                     # ok
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" localhost:18080/ocs-dockerjobs-app.zip   # 200 application/zip
DOCKER_CONTEXT=default docker rm -f djapp-smoke
```

Expected: the outputs in the comments.

- [ ] **Step 4: Write the local Grafana and the CI**

`docker-compose.yaml`:

```yaml
# Local Grafana for developing the app:
#   npm run dev            # rebuilds dist/ on change
#   docker compose up      # Grafana on http://localhost:3000, admin / admin
# The plugin is mounted from dist/, unsigned and in development mode; the
# backend is expected on the host, port 18000 (provisioning/plugins/apps.yaml).
#
# On this workstation bare `docker` may point at a remote swarm: run with
# DOCKER_CONTEXT=default.
services:
  grafana:
    image: grafana/grafana:${GRAFANA_VERSION:-13.2.0}
    ports:
      - "${GRAFANA_PORT:-3000}:3000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: ocs-dockerjobs-app
      GF_DEFAULT_APP_MODE: development
      GF_DATAPROXY_SEND_USER_HEADER: "true"
      GF_LOG_FILTERS: plugin.ocs-dockerjobs-app:debug
    volumes:
      - ./dist:/var/lib/grafana/plugins/ocs-dockerjobs-app:ro
      - ./provisioning:/etc/grafana/provisioning:ro
```

`provisioning/plugins/apps.yaml`:

```yaml
# Local development only (docker-compose.yaml): the app talks to a backend
# running on this machine, port 18000, with API_TOKEN=dev-token, e.g.
#   cd ../docker-jobs-backend && API_TOKEN=dev-token DATABASE_URL=sqlite:///./dev.db LOCK_FILE=./dev.lock \
#     SCHEDULER_ENABLED=false OTEL_SDK_DISABLED=true \
#     .venv/bin/uvicorn --factory docker_jobs_backend.main:create_app --host 0.0.0.0 --port 18000
# The swarm's provisioning is docker-jobs-backend's deploy/grafana/docker-jobs-app.yaml.
apiVersion: 1

apps:
  - type: ocs-dockerjobs-app
    org_id: 1
    disabled: false
    jsonData:
      backendUrl: http://host.docker.internal:18000
      lokiDatasourceUid: loki
    secureJsonData:
      apiToken: dev-token
```

`provisioning/datasources/loki.yaml`:

```yaml
# Local development only: a Loki on the host, port 3100, for the attempts' Logs links.
apiVersion: 1

datasources:
  - name: Loki
    uid: loki
    type: loki
    access: proxy
    url: http://host.docker.internal:3100
```

`.github/workflows/docker-jobs-app.yml`:

```yaml
name: docker-jobs-app CI/CD

# The Grafana app plugin, delivered as an nginx image serving the plugin zip
# (Dockerfile; deployed by docker-jobs-backend's deploy/). Like maas-dm-app.yml:
#   node-workflow.yml — npm ci -> lint -> build -> test
#   (package)         — the plugin zip as a workflow artifact
#   docker-build.yml  — the delivery image; its Dockerfile builds and packages
#                       the plugin itself, so no artifact is handed over
#
# docker-build.yml is called directly rather than through node-workflow's
# build-image: that path does not forward insecure-registry, which the plain-HTTP
# Nexus Docker connector needs.
#
# Version: the release tag (x.y.z) on tags, package.json's version otherwise.
# Signing: only when GRAFANA_ACCESS_POLICY_TOKEN and the SIGN_ROOT_URLS variable
# exist; unsigned otherwise (Grafana must allow it).

on:
  push:
    branches:
      - "develop"
    tags:
      - "[0-9]+.[0-9]+.[0-9]+"
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  node:
    permissions:
      contents: read
    uses: CSC-Operations-Coordination-Service/workflow-catalog/.github/workflows/node-workflow.yml@develop
    with:
      working-directory: .
      node-version: "22"
      use-nexus-registry: true
      run-tests: true
      test-command: npm run test:ci
    secrets: inherit

  package:
    needs: node
    runs-on: self-hosted
    container:
      image: node:22
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Set up Nexus npm registry
        uses: CSC-Operations-Coordination-Service/workflow-catalog/.github/actions/npm-context@develop
        with:
          registry-repo: npm-proxy
          nexus-host: ${{ secrets.NEXUS_HOST }}
          nexus-port: ${{ secrets.NEXUS_PORT }}
          nexus-username: ${{ secrets.NEXUS_USERNAME }}
          nexus-password: ${{ secrets.NEXUS_PASSWORD }}

      - name: Install zip
        run: apt-get update && apt-get install -y --no-install-recommends zip

      - name: Install dependencies
        run: npm ci --no-audit --no-fund

      - name: Package
        env:
          VERSION: ${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}
          GRAFANA_ACCESS_POLICY_TOKEN: ${{ secrets.GRAFANA_ACCESS_POLICY_TOKEN }}
          SIGN_ROOT_URLS: ${{ vars.SIGN_ROOT_URLS }}
        run: ./scripts/package.sh

      - name: Upload the plugin zip
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: ocs-dockerjobs-app-zip
          path: |
            ocs-dockerjobs-app-*.zip
            ocs-dockerjobs-app-*.zip.sha256
          if-no-files-found: error

      # This container runs as root, and a root-owned workspace breaks the next
      # non-container checkout.
      - name: Return workspace ownership to the runner user
        if: always()
        run: |
          owner=$(stat -c '%u:%g' "$RUNNER_TEMP")
          chown -R "$owner" "$GITHUB_WORKSPACE" || true

  docker:
    needs: node
    if: github.ref == 'refs/heads/develop' || startsWith(github.ref, 'refs/tags/')
    permissions:
      contents: read
      packages: write
    uses: CSC-Operations-Coordination-Service/workflow-catalog/.github/workflows/docker-build.yml@develop
    with:
      image-name: docker-jobs-app
      context: .
      dockerfile: Dockerfile
      build-args: |
        VERSION=${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}
      mount-npm-registry: true
      release: ${{ startsWith(github.ref, 'refs/tags/') }}
      environment: ${{ startsWith(github.ref, 'refs/tags/') && 'prod' || 'dev' }}
      insecure-registry: true
    secrets: inherit
```

- [ ] **Step 5: Write the README**

`README.md`:

```markdown
# docker-jobs-app

Grafana app plugin `ocs-dockerjobs-app` ("Docker Jobs"), the UI of
[docker-jobs-backend](../docker-jobs-backend/README.md), for **Grafana 13.2** and later
(`grafanaDependency >=13.2.0`, React 19). Frontend only: every call goes through
Grafana's plugin proxy to the backend.

| Page | Role | What it does |
| --- | --- | --- |
| Jobs (default) | Viewer | every job, its schedule, next run and newest run; Editors: **Run now** (its latest ended interval), enable/disable, delete, **New job** |
| Job editor | Editor | `jobs/new`, `jobs/<name>/edit`: image, schedule, command one argument per row (with a *paste a command line* splitter that keeps `{{ ... }}` whole), env, params, retries, limits, networks, constraints, secrets, configs, mounts; **Preview** renders the command for an interval and lists the swarm objects a launch would miss |
| Runs | Viewer | newest interval first, `?job=&state=` filters, paged; expand a run for its attempts — command, exit code, node, error, **Logs** in Explore — and, for Editors, **Rerun** (an ended run) or **Cancel run** (one still going), with a note |
| Docker jobs overview | Viewer | bundled dashboard: last tick, Docker reachable, runs waiting/running, missing intervals, failed runs, data covered until, attempts by outcome, p95 duration |
| Configuration | Admin | backend URL, API token, Loki datasource |

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
```

- [ ] **Step 6: Run everything green, and commit**

Run: `npm run test:ci && npm run typecheck && npm run lint`
Expected: `Tests: 51 passed, 51 total`, clean.

```bash
git add scripts Dockerfile .dockerignore docker docker-compose.yaml provisioning .github README.md
git commit -m "build: plugin zip, delivery image, local Grafana and CI" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The app in the docker-jobs stack, and end to end

**Files (in `/home/aagazzi/work/docker-jobs-backend`):**
- Modify: `deploy/docker-compose.yml` (add the `app` service), `deploy/.env.example`, `deploy/deploy.sh` (`REQUIRED`), `deploy/README.md`
- Create: `deploy/grafana/docker-jobs-app.yaml`, `deploy/grafana/grafana.env.example`

**Interfaces:**
- Consumes: the `docker-jobs-app` image (Task 8); the backend's `API_TOKEN` secret and its `backend` service.
- Produces:
  - the service `docker-jobs_app` on `MONITORING_NETWORK`, port 8080;
  - Grafana's provisioning: the app pointed at `http://docker-jobs_backend:8000`, with the token from the stack's secret.

- [ ] **Step 1: Add the service and its version**

In `deploy/docker-compose.yml`, insert this service after the `socket-proxy` service, just before the top-level `secrets:` key:

```yaml
  app:
    # The Grafana app's zip, served to the Grafana that installs it at startup
    # (GF_PLUGINS_PREINSTALL_SYNC, deploy/grafana/grafana.env.example).
    image: ${DJ_IMAGE_REGISTRY}/docker-jobs-app:${DJ_APP_VERSION}
    read_only: true
    tmpfs: [/tmp]
    networks: [monitoring]
    logging: *logging-loki
    deploy:
      replicas: 1
      update_config:
        parallelism: 1
        delay: 5s
        # stateless: start the new one before stopping the old
        order: start-first
      restart_policy:
        condition: any
```

Also make these edits:
- In `deploy/.env.example`, add a line after `DJ_BACKEND_VERSION=0.1.0`: `DJ_APP_VERSION=0.1.0`.
- In `deploy/deploy.sh`, add `DJ_APP_VERSION` to `REQUIRED`, after `DJ_BACKEND_VERSION`.
- In `deploy/README.md`'s services table, add this row after the `socket-proxy` row:

```markdown
| `app` | `docker-jobs-app` | monitoring | serves the Grafana app's zip (`ocs-dockerjobs-app`) to Grafana |
```

- [ ] **Step 2: Write Grafana's side**

`deploy/grafana/docker-jobs-app.yaml`:

```yaml
# Grafana app provisioning for the Docker Jobs app (ocs-dockerjobs-app): mount it
# in the Grafana that runs the app, at
# /etc/grafana/provisioning/plugins/docker-jobs-app.yaml. Grafana expands
# ${...} from its environment (grafana.env.example) and reads $__file{...}:
# attach this stack's API token secret (DJ_API_TOKEN_SECRET_NAME, external)
# to the Grafana service as /run/secrets/docker_jobs_api_token.
apiVersion: 1

apps:
  - type: ocs-dockerjobs-app
    org_id: 1
    disabled: false
    jsonData:
      backendUrl: http://docker-jobs_backend:8000
      lokiDatasourceUid: ${LOKI_DATASOURCE_UID}
    secureJsonData:
      apiToken: $__file{/run/secrets/docker_jobs_api_token}
```

`deploy/grafana/grafana.env.example`:

```bash
# Environment to add to the Grafana service that hosts the Docker Jobs app.
# Grafana 13.2 or later (the app needs React 19). That Grafana must be on
# MONITORING_NETWORK, to reach docker-jobs_app and docker-jobs_backend.

# Install the plugin at startup from this stack's app service (keep the version
# in step with DJ_APP_VERSION):
GF_PLUGINS_PREINSTALL_SYNC=ocs-dockerjobs-app@0.1.0@http://docker-jobs_app:8080/ocs-dockerjobs-app-0.1.0.zip

# The zip is unsigned unless scripts/package.sh was given a signing token.
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=ocs-dockerjobs-app

# The plugin proxy then sets X-Grafana-User, overwriting whatever the browser
# sent: the backend records it on every change, manual run, rerun and cancel.
GF_DATAPROXY_SEND_USER_HEADER=true

# For the provisioning files: the Loki datasource the attempts' Logs links open
# (docker-jobs-app.yaml), the Mimir one the alerts query (docker-jobs-alerts.yaml).
LOKI_DATASOURCE_UID=
MIMIR_DATASOURCE_UID=
```

In `deploy/README.md`, replace the bullet that starts with `- **The app.**` in "The Grafana side" with:

```markdown
- **The app.** The `app` service serves the plugin zip. The Grafana that runs it needs the
  environment in [grafana/grafana.env.example](grafana/grafana.env.example) — install from
  `docker-jobs_app`, allow it unsigned, send the user header — the provisioning file
  [grafana/docker-jobs-app.yaml](grafana/docker-jobs-app.yaml) mounted at
  `/etc/grafana/provisioning/plugins/docker-jobs-app.yaml`, and this stack's API token
  secret attached as `/run/secrets/docker_jobs_api_token`. It must be on
  `MONITORING_NETWORK`. Bump `DJ_APP_VERSION` and the version in
  `GF_PLUGINS_PREINSTALL_SYNC` together; deploy this stack before restarting Grafana.
```

- [ ] **Step 3: Check that the stack renders, and commit in the backend repository**

```bash
cd /home/aagazzi/work/docker-jobs-backend/deploy
[ -f .env ] || cp .env.example .env                                      # local and gitignored
grep -q '^DJ_APP_VERSION=' .env || echo 'DJ_APP_VERSION=0.1.0' >> .env
[ -s secrets/api-token ] || openssl rand -hex 32 > secrets/api-token
DOCKER_CONTEXT=default ./deploy.sh check
cd .. && .venv/bin/pytest -q -p no:cacheprovider --no-cov | tail -1
git add deploy && git commit -m "feat: serve the Grafana app from the docker-jobs stack" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Expected: `OK: .env, the token and docker-compose.yml are consistent`, then the backend suite still passing.

- [ ] **Step 4: End to end: the built app in a real Grafana, against the real backend**

Port 3000 may be taken on this workstation, so Grafana goes on 13000. Start the backend on the host, with a token and without its scheduler. Then start the app's local Grafana:

```bash
mkdir -p /tmp/dj-app-e2e
cd /home/aagazzi/work/docker-jobs-backend
API_TOKEN=dev-token DATABASE_URL=sqlite:////tmp/dj-app-e2e/jobs.db LOCK_FILE=/tmp/dj-app-e2e/scheduler.lock \
  SCHEDULER_ENABLED=false OTEL_SDK_DISABLED=true \
  nohup .venv/bin/uvicorn --factory docker_jobs_backend.main:create_app --host 0.0.0.0 --port 18000 \
  > /tmp/dj-app-e2e/backend.log 2>&1 &
echo $! > /tmp/dj-app-e2e/backend.pid
cd /home/aagazzi/work/docker-jobs-app
npm run build
DOCKER_CONTEXT=default GRAFANA_PORT=13000 docker compose -p djapp-e2e up -d
for i in $(seq 1 60); do curl -fsS localhost:13000/api/health >/dev/null 2>&1 && break; sleep 2; done
```

Then check the proxy, the roles and the dashboard:

```bash
G() { curl -s -u admin:admin -H 'Content-Type: application/json' "$@"; }
P=localhost:13000/api/plugin-proxy/ocs-dockerjobs-app/api/v1
curl -s -o /dev/null -w "backend without token: %{http_code}\n" localhost:18000/api/v1/jobs
G -X POST $P/jobs -d '{"name":"e2e","image":"busybox:1.36","command":["true"],"schedule":"0 * * * *"}' \
  | python3 -c 'import json,sys; print("created by", json.load(sys.stdin)["updated_by"])'
G -o /dev/null -w "trigger %{http_code}\n" -X POST $P/jobs/e2e/trigger -d '{"note":"e2e"}'
G -o /dev/null -w "runs %{http_code}\n" "$P/runs?job=e2e"
G -o /dev/null -w "viewer user %{http_code}\n" -X POST localhost:13000/api/admin/users \
  -d '{"name":"viewer","login":"viewer","password":"viewer-pass-123","OrgId":1}'
curl -s -u viewer:viewer-pass-123 -o /dev/null -w "viewer GET %{http_code}\n" $P/jobs
curl -s -u viewer:viewer-pass-123 -H 'Content-Type: application/json' -o /dev/null \
  -w "viewer POST %{http_code}\n" -X POST $P/jobs/e2e/trigger -d '{}'
curl -s -u viewer:viewer-pass-123 -o /dev/null -w "viewer DELETE %{http_code}\n" -X DELETE $P/jobs/e2e
G -o /dev/null -w "dashboard %{http_code}\n" localhost:13000/api/dashboards/uid/ocs-dockerjobs-overview
curl -s -o /dev/null -w "module.js %{http_code}\n" localhost:13000/public/plugins/ocs-dockerjobs-app/module.js
G -o /dev/null -w "delete as admin %{http_code}\n" -X DELETE $P/jobs/e2e
```

Expected, in order:
- `backend without token: 401`
- `created by admin`
- `trigger 201`
- `runs 200`
- `viewer user 200`
- `viewer GET 200`
- `viewer POST 403`
- `viewer DELETE 403`
- `dashboard 200`
- `module.js 200`
- `delete as admin 204`

- [ ] **Step 5: Look at the pages, as an Editor and as a Viewer**

Open http://localhost:13000/a/ocs-dockerjobs-app/jobs (admin / admin) and check each item:

- **Jobs:** "New job" is there.
- **New job:** create `e2e-ui` with
  - image `busybox:1.36`;
  - command pasted as `sh -c "echo {{ data_interval_start | iso_ms }}"`. It shows three rows, the last one `echo {{ data_interval_start | iso_ms }}`.
  - **Preview** shows `command: ["sh","-c","echo 2026-…T…:00:00.000Z"]`, the next runs, and no problems.
  - **Save** returns to Jobs.
- **Jobs:** `e2e-ui` shows `enabled` and its next run.
  - **Disable** turns it to `disabled`, and **Enable** back.
  - **Run now** asks first, then says `Run <n> of e2e-ui queued: …`.
- **Runs:** the run is `queued`, because the scheduler is off. Expand it: the attempt is `pending`, and there is a **Cancel run** button. Cancel it with a note, and the run becomes `cancelled` with `cancelled by admin: <note>`. **Rerun** then queues it again.
- **Docker jobs overview:** it opens and the panels show "No data", because there is no Mimir locally.
- **As the Viewer** (`viewer` / `viewer-pass-123`): Jobs shows no New job, Run now, Disable or Delete, and an expanded run shows no Rerun or Cancel.

- [ ] **Step 6: Clean up**

```bash
cd /home/aagazzi/work/docker-jobs-app
DOCKER_CONTEXT=default docker compose -p djapp-e2e down -v
kill "$(cat /tmp/dj-app-e2e/backend.pid)"
rm -rf /tmp/dj-app-e2e ocs-dockerjobs-app-*.zip*
git status --short    # nothing: the e2e left no tracked change
```

## Verification

- **App repository:** `npm run test:ci` (51 tests), `npm run typecheck`, `npm run lint` and `npm run build` all pass after every task. CI's node-workflow runs the same.
- **Delivery:** `scripts/package.sh` produces a zip whose top directory is `ocs-dockerjobs-app/`, and the image serves it with `/health`.
- **Integration:** Task 9 Step 4 checks the real chain: Grafana 13.2 → plugin proxy (token, user header, role per method) → docker-jobs-backend, plus the auto-imported dashboard. Step 5 is the visual pass over every page, as an Editor and as a Viewer.
- **Backend repository:** `deploy.sh check` renders the stack with the `app` service, and the backend suite stays green.

## Out of scope (follow-ups)

- **The swarm Grafana.** It needs the env, the provisioning file and the secret, and its stack lives in csc-ocs-ansible. Also needed there: the Alloy → Mimir OTLP endpoint fix and the Alertmanager route, as the backend plan says.
- **Signing the plugin** (GRAFANA_ACCESS_POLICY_TOKEN, SIGN_ROOT_URLS), when Grafana should stop allowing it unsigned.
- **Moving the existing crontab jobs into job definitions**, through this app.
