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
