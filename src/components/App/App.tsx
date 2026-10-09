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
