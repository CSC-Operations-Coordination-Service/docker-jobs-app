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
