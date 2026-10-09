import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { cancelRun, getRun, rerunRun } from '../api';
import { AppSettings } from '../settings';
import { aRun, anAttempt } from '../test-fixtures';
import { asRole } from '../test-utils';
import { RunDetails } from './RunDetails';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getRun: jest.fn(),
  rerunRun: jest.fn(),
  cancelRun: jest.fn(),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.MockedFunction<T>;

function renderDetails(lokiDatasourceUid?: string, onChanged = jest.fn()) {
  render(
    <AppSettings.Provider value={{ backendUrl: 'http://b', lokiDatasourceUid }}>
      <RunDetails runId={7} onChanged={onChanged} />
    </AppSettings.Provider>
  );
  return onChanged;
}

describe('RunDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asRole('Editor');
  });

  it('shows the attempts and opens their logs in Explore', async () => {
    mocked(getRun).mockResolvedValue(aRun());
    renderDetails('loki-uid');

    const link = await screen.findByRole('link', { name: /logs/i });
    expect(link.getAttribute('href')).toContain('/explore?schemaVersion=1&panes=');
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('djobs_collect_7_1');
    expect(screen.getByText('["--start","2026-10-09T00:00:00.000Z"]')).toBeInTheDocument();
  });

  it('has no Logs link without a Loki datasource', async () => {
    mocked(getRun).mockResolvedValue(aRun());
    renderDetails(undefined);

    expect(await screen.findByText('node-1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /logs/i })).not.toBeInTheDocument();
  });

  it('reruns an ended run with a note, then tells the list', async () => {
    mocked(getRun).mockResolvedValue(aRun({ state: 'failed' }));
    mocked(rerunRun).mockResolvedValue(
      aRun({
        state: 'queued',
        attempts: [anAttempt({ state: 'failed' }), anAttempt({ try_number: 2, state: 'pending' })],
      })
    );
    const onChanged = renderDetails();

    fireEvent.click(await screen.findByRole('button', { name: 'Rerun' }));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'upstream fixed' } });
    const buttons = screen.getAllByRole('button', { name: 'Rerun' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(rerunRun).toHaveBeenCalledWith(7, 'upstream fixed'));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText('pending')).toBeInTheDocument();
  });

  it('cancels a run that has not ended', async () => {
    mocked(getRun).mockResolvedValue(aRun({ state: 'running', finished_at: null }));
    mocked(cancelRun).mockResolvedValue(aRun({ state: 'cancelled' }));
    renderDetails();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    const buttons = screen.getAllByRole('button', { name: 'Cancel run' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith(7, ''));
  });

  it('offers a Viewer neither rerun nor cancel', async () => {
    asRole('Viewer');
    mocked(getRun).mockResolvedValue(aRun({ state: 'failed' }));
    renderDetails();

    expect(await screen.findByText('node-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rerun' })).not.toBeInTheDocument();
  });
});
