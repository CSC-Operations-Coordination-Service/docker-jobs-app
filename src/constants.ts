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
