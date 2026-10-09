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
