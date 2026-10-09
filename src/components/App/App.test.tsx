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
