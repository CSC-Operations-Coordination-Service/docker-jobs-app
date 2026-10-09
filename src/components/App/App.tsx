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
