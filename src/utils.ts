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
