import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { type JobCreate, type Preview, createJob, listJobs, previewJob, updateJob } from '../../api';
import { aJob } from '../../test-fixtures';
import { fetchError } from '../../test-utils';
import { jobToSpec } from '../../utils';
import { ImportJobs } from './ImportJobs';

jest.mock('../../api', () => ({
  ...jest.requireActual('../../api'),
  createJob: jest.fn(),
  listJobs: jest.fn(),
  previewJob: jest.fn(),
  updateJob: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

const preview = (problems: string[] = []): Preview => ({
  data_interval_start: '2026-10-09T00:00:00Z',
  data_interval_end: '2026-10-09T01:00:00Z',
  entrypoint: null,
  command: [],
  env: {},
  next_fire_times: [],
  problems,
});

const definition = (name: string, overrides: Partial<JobCreate> = {}): JobCreate => ({
  name,
  ...jobToSpec(aJob({ name })),
  start_date: null,
  ...overrides,
});

// the file: one new, one changed, one unchanged, one invalid
const FILE = [
  definition('brand-new'),
  definition('edited', { retries: 3 }),
  definition('same'),
  definition('broken', { schedule: '@hourly' }),
];

describe('ImportJobs', () => {
  const onDone = jest.fn();
  const onDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mocked(listJobs).mockResolvedValue([aJob({ name: 'edited' }), aJob({ name: 'same' })]);
    mocked(previewJob).mockImplementation(async (job) => {
      if (job.name === 'broken') {
        throw fetchError({
          detail: [{ loc: ['body', 'job', 'schedule'], msg: "not a 5-field cron expression: '@hourly'" }],
        });
      }
      return preview(job.name === 'brand-new' ? ["network 'ocs_rabbitmq' does not exist"] : []);
    });
    mocked(createJob).mockImplementation(async (job) => aJob({ name: job.name }));
    mocked(updateJob).mockImplementation(async (name) => aJob({ name }));
  });

  const open = () => render(<ImportJobs definitions={FILE} onDone={onDone} onDismiss={onDismiss} />);

  it('says what importing each job would do', async () => {
    open();

    expect(await screen.findByText('brand-new')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(screen.getByText("network 'ocs_rabbitmq' does not exist")).toBeInTheDocument();
    expect(screen.getByText('changed')).toBeInTheDocument();
    expect(screen.getByText('changes retries')).toBeInTheDocument();
    expect(screen.getByText('unchanged')).toBeInTheDocument();
    expect(screen.getByText('invalid')).toBeInTheDocument();
    expect(screen.getByText("job.schedule: not a 5-field cron expression: '@hourly'")).toBeInTheDocument();
  });

  it('ticks the new jobs, leaves overwriting a changed one to you, offers nothing else', async () => {
    open();

    expect(await screen.findByRole('checkbox', { name: 'Import brand-new' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Import edited' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Import same' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Import broken' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 job' })).toBeEnabled();
  });

  it('creates the ticked new jobs and overwrites the ticked changed ones, nothing else', async () => {
    open();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Import edited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 jobs' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ notice: '1 created, 1 updated', error: undefined }));
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledWith(FILE[0]);
    const { name, ...spec } = FILE[1];
    expect(updateJob).toHaveBeenCalledTimes(1);
    expect(updateJob).toHaveBeenCalledWith(name, spec);
  });

  it('carries on past a job that fails to save, and says which and why', async () => {
    mocked(createJob).mockRejectedValue(fetchError({ detail: "job 'brand-new' exists" }, 409));
    open();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Import edited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 jobs' }));

    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ notice: '1 updated', error: "1 failed: brand-new: job 'brand-new' exists" })
    );
  });

  it('imports nothing until something is ticked', async () => {
    open();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Import brand-new' }));

    expect(screen.getByRole('button', { name: 'Import 0 jobs' })).toBeDisabled();
  });

  it('says why the file cannot be compared with the jobs', async () => {
    mocked(listJobs).mockRejectedValue(fetchError({ message: 'plugin route match not found' }, 404));
    open();

    expect(await screen.findByText('plugin route match not found')).toBeInTheDocument();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('closes without writing anything when cancelled', async () => {
    open();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onDismiss).toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(updateJob).not.toHaveBeenCalled();
  });
});
