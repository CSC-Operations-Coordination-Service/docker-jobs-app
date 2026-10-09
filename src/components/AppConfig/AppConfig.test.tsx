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
