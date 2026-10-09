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
