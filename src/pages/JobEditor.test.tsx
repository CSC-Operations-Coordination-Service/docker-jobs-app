import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { createJob, getJob, previewJob, updateJob } from '../api';
import { aJob } from '../test-fixtures';
import { fetchError, renderAt } from '../test-utils';
import { jobToSpec } from '../utils';
import { JobEditor } from './JobEditor';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PluginPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  createJob: jest.fn(),
  getJob: jest.fn(),
  previewJob: jest.fn(),
  updateJob: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

function fillNewJob() {
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'collect' } });
  fireEvent.change(screen.getByLabelText(/^image/i), { target: { value: 'maas-collector:3.10.1' } });
  fireEvent.change(screen.getByLabelText('Paste a command line into arguments'), {
    target: { value: 'maas_collector.rawdata.cli.odata --replay-start-date {{ data_interval_start | iso_ms }}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split into arguments' }));
}

describe('JobEditor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a job from the form, one argument per row', async () => {
    mocked(createJob).mockResolvedValue(aJob());
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fillNewJob();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createJob).toHaveBeenCalled());
    expect(mocked(createJob).mock.calls[0][0]).toMatchObject({
      name: 'collect',
      image: 'maas-collector:3.10.1',
      schedule: '0 * * * *',
      entrypoint: null,
      command: ['maas_collector.rawdata.cli.odata', '--replay-start-date', '{{ data_interval_start | iso_ms }}'],
      catchup: true,
    });
  });

  it('keeps the form as typed and says what the backend refused', async () => {
    mocked(createJob).mockRejectedValue(
      fetchError({ detail: [{ loc: ['body'], msg: "Value error, template command[2]: 'x' is undefined" }] })
    );
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fillNewJob();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Value error, template command[2]: 'x' is undefined")).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toHaveValue('collect');
  });

  it('cannot save a name the backend would refuse', () => {
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Collect_Hourly' } });
    fireEvent.change(screen.getByLabelText(/^image/i), { target: { value: 'img:1' } });

    expect(screen.getByText('Not a valid job name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits a job: loads it, keeps its name, PUTs its definition', async () => {
    mocked(getJob).mockResolvedValue(aJob());
    mocked(updateJob).mockResolvedValue(aJob({ image: 'maas-collector:3.11.0' }));
    renderAt(<JobEditor />, '/jobs/collect/edit', '/jobs/:name/edit');

    const image = await screen.findByLabelText(/^image/i);
    expect(screen.getByLabelText(/^name/i)).toBeDisabled();
    fireEvent.change(image, { target: { value: 'maas-collector:3.11.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateJob).toHaveBeenCalledWith('collect', { ...jobToSpec(aJob()), image: 'maas-collector:3.11.0' })
    );
  });

  it('previews the rendered command and what a launch would miss', async () => {
    mocked(previewJob).mockResolvedValue({
      data_interval_start: '2026-10-09T00:00:00Z',
      data_interval_end: '2026-10-09T01:00:00Z',
      entrypoint: null,
      command: ['--start', '2026-10-09T00:00:00.000Z'],
      env: {},
      next_fire_times: ['2026-10-09T11:00:00Z'],
      problems: ["secret 'cdse' does not exist"],
    });
    renderAt(<JobEditor />, '/a/ocs-dockerjobs-app/jobs/new');

    fillNewJob();
    fireEvent.change(screen.getByLabelText('Preview for the interval of'), {
      target: { value: '2026-10-09T00:30:00Z' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText("secret 'cdse' does not exist")).toBeInTheDocument();
    expect(screen.getByText('command: ["--start","2026-10-09T00:00:00.000Z"]')).toBeInTheDocument();
    expect(mocked(previewJob).mock.calls[0][1]).toBe('2026-10-09T00:30:00Z');
  });
});
