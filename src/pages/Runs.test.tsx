import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { listJobs, listRuns } from '../api';
import { aJob, aRun } from '../test-fixtures';
import { renderAt } from '../test-utils';
import { PAGE_SIZE, Runs } from './Runs';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PluginPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listJobs: jest.fn(),
  listRuns: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

describe('Runs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(listJobs).mockResolvedValue([aJob()]);
  });

  it('filters by the job and state in the URL', async () => {
    mocked(listRuns).mockResolvedValue([aRun({ state: 'failed' })]);
    renderAt(<Runs />, '/a/ocs-dockerjobs-app/runs?job=collect&state=failed');

    expect(await screen.findByText('2026-10-09 00:00 → 01:00')).toBeInTheDocument();
    expect(listRuns).toHaveBeenCalledWith({ job: 'collect', state: 'failed', offset: 0, size: PAGE_SIZE });
  });

  it('pages to older runs while pages are full', async () => {
    const page = Array.from({ length: PAGE_SIZE }, (_, i) => aRun({ id: i + 1 }));
    mocked(listRuns).mockResolvedValue(page);
    renderAt(<Runs />, '/a/ocs-dockerjobs-app/runs');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Older' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));

    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith({
        job: undefined,
        state: undefined,
        offset: PAGE_SIZE,
        size: PAGE_SIZE,
      })
    );
  });
});
