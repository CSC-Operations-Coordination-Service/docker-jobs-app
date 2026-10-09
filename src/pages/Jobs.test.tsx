import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { deleteJob, getJob, listJobs, listRuns, triggerJob, updateJob } from '../api';
import { aJob, aRun } from '../test-fixtures';
import { asRole, fetchError, renderAt } from '../test-utils';
import { jobToSpec } from '../utils';
import { Jobs } from './Jobs';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PluginPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getJob: jest.fn(),
  listJobs: jest.fn(),
  listRuns: jest.fn(),
  triggerJob: jest.fn(),
  updateJob: jest.fn(),
  deleteJob: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

describe('Jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(listJobs).mockResolvedValue([aJob()]);
    mocked(listRuns).mockResolvedValue([aRun({ state: 'failed' })]);
    mocked(getJob).mockResolvedValue(aJob());
    asRole('Editor');
  });

  it('shows each job with its schedule, next run and newest run', async () => {
    renderAt(<Jobs />);

    expect(await screen.findByText('collect')).toBeInTheDocument();
    expect(screen.getByText('0 * * * *')).toBeInTheDocument();
    expect(screen.getByText('2026-10-09 11:00:00')).toBeInTheDocument();
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.getByText('2026-10-09 00:00 → 01:00')).toBeInTheDocument();
    expect(listRuns).toHaveBeenCalledWith({ job: 'collect', size: 1 });
  });

  it('shows a Viewer the jobs and their runs, no actions', async () => {
    asRole('Viewer');
    renderAt(<Jobs />);

    expect(await screen.findByText('collect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      '/a/ocs-dockerjobs-app/runs?job=collect'
    );
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new job/i })).not.toBeInTheDocument();
  });

  it('disables a job by sending its whole definition back, enabled off', async () => {
    mocked(updateJob).mockResolvedValue(aJob({ enabled: false }));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(updateJob).toHaveBeenCalledWith('collect', { ...jobToSpec(aJob()), enabled: false }));
    expect(await screen.findByText('collect disabled')).toBeInTheDocument();
  });

  it('asks before running a job now, then says which run was queued', async () => {
    mocked(triggerJob).mockResolvedValue(aRun({ id: 12, state: 'queued' }));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(triggerJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith('collect', undefined, ''));
    expect(await screen.findByText('Run 12 of collect queued: 2026-10-09 00:00 → 01:00')).toBeInTheDocument();
  });

  it('deletes a job only once confirmed', async () => {
    mocked(deleteJob).mockResolvedValue(undefined);
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete collect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith('collect'));
  });

  it('says why the jobs cannot be loaded', async () => {
    mocked(listJobs).mockRejectedValue(fetchError({ message: 'plugin route match not found' }, 404));
    renderAt(<Jobs />);

    expect(await screen.findByText('plugin route match not found')).toBeInTheDocument();
  });

  it("keeps an action's error visible after the list reloads", async () => {
    const refusal = "job 'collect' has 1 attempt(s) running: cancel them, or wait";
    mocked(deleteJob).mockRejectedValue(fetchError({ detail: refusal }, 409));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete collect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });

  it('disables a job from a fresh copy of its definition, not the listed one', async () => {
    mocked(getJob).mockResolvedValue(aJob({ image: 'maas-collector:3.11.0' }));
    mocked(updateJob).mockResolvedValue(aJob({ enabled: false }));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(updateJob).toHaveBeenCalledWith('collect', {
        ...jobToSpec(aJob({ image: 'maas-collector:3.11.0' })),
        enabled: false,
      })
    );
    expect(getJob).toHaveBeenCalledWith('collect');
  });

  it('runs now the interval of a given date, with a note', async () => {
    mocked(triggerJob).mockResolvedValue(aRun({ id: 13, state: 'queued' }));
    renderAt(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    fireEvent.change(screen.getByLabelText(/a date in the interval/i), { target: { value: '2026-10-01T05:30:00Z' } });
    fireEvent.change(screen.getByLabelText(/^note/i), { target: { value: 'missing interval' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(triggerJob).toHaveBeenCalledWith('collect', '2026-10-01T05:30:00Z', 'missing interval'));
  });
});
