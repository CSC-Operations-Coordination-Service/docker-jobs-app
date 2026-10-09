// Test data shaped like docker-jobs-backend's responses.
import type { Attempt, Job, Run } from './api';
import { emptyJob } from './utils';

export function aJob(overrides: Partial<Job> = {}): Job {
  return {
    ...emptyJob(),
    name: 'collect',
    image: '127.0.0.1:8085/maas-collector:3.10.1',
    command: ['--start', '{{ data_interval_start | iso_ms }}'],
    start_date: '2026-10-09T00:00:00Z',
    schedule_cursor: null,
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
    updated_by: 'aagazzi',
    next_fire_at: '2026-10-09T11:00:00Z',
    ...overrides,
  };
}

export function anAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    try_number: 1,
    reason: 'scheduled',
    state: 'success',
    requested_by: '',
    note: '',
    not_before: null,
    created_at: '2026-10-09T01:00:00Z',
    launched_at: '2026-10-09T01:00:05Z',
    started_at: '2026-10-09T01:00:10Z',
    finished_at: '2026-10-09T01:02:00Z',
    service_name: 'djobs_collect_7_1',
    node_id: 'node-1',
    rendered_entrypoint: null,
    rendered_command: ['--start', '2026-10-09T00:00:00.000Z'],
    exit_code: 0,
    error: null,
    loki_selector: '{swarm_stack="djobs", swarm_service="djobs_collect_7_1"}',
    ...overrides,
  };
}

export function aRun(overrides: Partial<Run> = {}): Run {
  const attempt = anAttempt();
  return {
    id: 7,
    job: 'collect',
    run_type: 'scheduled',
    state: 'success',
    logical_date: '2026-10-09T00:00:00Z',
    data_interval_start: '2026-10-09T00:00:00Z',
    data_interval_end: '2026-10-09T01:00:00Z',
    try_number: 1,
    max_tries: 1,
    created_at: '2026-10-09T01:00:00Z',
    started_at: '2026-10-09T01:00:05Z',
    finished_at: '2026-10-09T01:02:00Z',
    requested_by: '',
    note: '',
    last_attempt: attempt,
    attempts: [attempt],
    ...overrides,
  };
}
