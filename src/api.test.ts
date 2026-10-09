import { of } from 'rxjs';

import { cancelRun, errorMessage, listRuns, previewJob, rerunRun, triggerJob, updateJob } from './api';
import { aJob } from './test-fixtures';
import { jobToSpec } from './utils';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

const BASE = '/api/plugin-proxy/ocs-dockerjobs-app/api/v1';

/** the options of the only call made */
function sent() {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  return mockFetch.mock.calls[0][0];
}

describe('the API client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockReturnValue(of({ data: {} }));
  });

  it('PUTs a job definition at its escaped name', async () => {
    const spec = jobToSpec(aJob());
    await updateJob('a b', spec);

    expect(sent()).toMatchObject({ method: 'PUT', url: `${BASE}/jobs/a%20b`, data: spec, showErrorAlert: false });
  });

  it('triggers the latest interval unless given a date', async () => {
    await triggerJob('collect');

    expect(sent()).toMatchObject({
      method: 'POST',
      url: `${BASE}/jobs/collect/trigger`,
      data: { logical_date: undefined, note: '' },
    });
  });

  it('previews a definition for an interval', async () => {
    const job = aJob();
    await previewJob(job, '2026-10-09T00:30:00Z');

    expect(sent()).toMatchObject({
      method: 'POST',
      url: `${BASE}/preview`,
      data: { job, logical_date: '2026-10-09T00:30:00Z' },
    });
  });

  it('filters runs with query parameters', async () => {
    await listRuns({ job: 'collect', state: 'failed', offset: 50, size: 50 });

    expect(sent()).toMatchObject({
      method: 'GET',
      url: `${BASE}/runs`,
      params: { job: 'collect', state: 'failed', offset: 50, size: 50 },
    });
  });

  it('reruns and cancels with a note', async () => {
    await rerunRun(7, 'upstream fixed');
    await cancelRun(8, 'wrong window');

    expect(mockFetch.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/runs/7/rerun`,
      data: { note: 'upstream fixed' },
    });
    expect(mockFetch.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/runs/8/cancel`,
      data: { note: 'wrong window' },
    });
  });
});

describe('errorMessage', () => {
  const fetchError = (data: unknown, status = 422) => ({ status, statusText: 'Unprocessable', data, config: {} });

  it('shows the backend detail', () => {
    expect(errorMessage(fetchError({ detail: 'job is disabled' }, 409))).toBe('job is disabled');
  });

  it('shows where each validation error is', () => {
    const detail = [
      { loc: ['body', 'command'], msg: "Value error, template command[1]: 'nope' is undefined" },
      { loc: ['body', 'name'], msg: 'String should match pattern' },
    ];

    expect(errorMessage(fetchError({ detail }))).toBe(
      "command: Value error, template command[1]: 'nope' is undefined; name: String should match pattern"
    );
  });

  it('falls back to Grafana message, then the status, then the error', () => {
    expect(errorMessage(fetchError({ message: 'plugin route match not found' }, 404))).toBe(
      'plugin route match not found'
    );
    expect(errorMessage(fetchError(undefined, 502))).toBe('502 Unprocessable');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
