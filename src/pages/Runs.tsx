import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  Combobox,
  ComboboxOption,
  InlineField,
  InlineSwitch,
  InteractiveTable,
  RadioButtonGroup,
  Stack,
} from '@grafana/ui';

import { Run, RunState, errorMessage, listJobs, listRuns } from '../api';
import { formatDate, formatInterval, stateColor } from '../utils';
import { RunDetails } from './RunDetails';

const REFRESH_MS = 15000;
export const PAGE_SIZE = 50;

const STATE_OPTIONS: Array<{ label: string; value: RunState | '' }> = [
  { label: 'All', value: '' },
  { label: 'Queued', value: 'queued' },
  { label: 'Running', value: 'running' },
  { label: 'Retrying', value: 'retrying' },
  { label: 'Success', value: 'success' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

type Cell = CellProps<Run>;

const columns: Array<Column<Run>> = [
  {
    id: 'interval',
    header: 'Interval (UTC)',
    cell: ({ row }: Cell) => formatInterval(row.original.data_interval_start, row.original.data_interval_end),
  },
  { id: 'job', header: 'Job' },
  { id: 'run_type', header: 'Type' },
  {
    id: 'state',
    header: 'State',
    cell: ({ row }: Cell) => <Badge text={row.original.state} color={stateColor(row.original.state)} />,
  },
  { id: 'try', header: 'Try', cell: ({ row }: Cell) => `${row.original.try_number}/${row.original.max_tries}` },
  { id: 'started_at', header: 'Started (UTC)', cell: ({ row }: Cell) => formatDate(row.original.started_at) },
  { id: 'finished_at', header: 'Ended (UTC)', cell: ({ row }: Cell) => formatDate(row.original.finished_at) },
  { id: 'requested_by', header: 'By', cell: ({ row }: Cell) => row.original.requested_by || '–' },
];

/** Runs, newest interval first; ?job=&state= preselects the filters. Expand a row for its attempts. */
export function Runs() {
  const location = useLocation();
  const initial = new URLSearchParams(location.search);
  const [job, setJob] = useState(initial.get('job') ?? '');
  const [state, setState] = useState<RunState | ''>((initial.get('state') as RunState | null) ?? '');
  const [offset, setOffset] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [jobNames, setJobNames] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await listRuns({ job: job || undefined, state: state || undefined, offset, size: PAGE_SIZE }));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [job, state, offset]);

  useEffect(() => {
    load();
    if (!autoRefresh) {
      return undefined;
    }
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, autoRefresh]);

  useEffect(() => {
    listJobs()
      .then((jobs) => setJobNames(jobs.map((item) => item.name)))
      .catch(() => setJobNames([]));
  }, []);

  const jobOptions = useMemo<Array<ComboboxOption<string>>>(
    () => [{ label: 'All jobs', value: '' }, ...jobNames.map((name) => ({ label: name, value: name }))],
    [jobNames]
  );

  return (
    <PluginPage>
      <Stack direction="column" gap={2}>
        <Stack gap={2} wrap="wrap" alignItems="center">
          <InlineField label="Job">
            <Combobox
              id="runs-job"
              width={30}
              options={jobOptions}
              value={job}
              onChange={(option) => {
                setJob(option.value);
                setOffset(0);
              }}
            />
          </InlineField>
          <InlineField label="State">
            <RadioButtonGroup
              options={STATE_OPTIONS}
              value={state}
              onChange={(value) => {
                setState(value);
                setOffset(0);
              }}
            />
          </InlineField>
          <InlineField label="Auto refresh">
            <InlineSwitch value={autoRefresh} onChange={(event) => setAutoRefresh(event.currentTarget.checked)} />
          </InlineField>
          <Button variant="secondary" icon={loading ? 'spinner' : 'sync'} onClick={load}>
            Refresh
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" title="Cannot load the runs">
            {error}
          </Alert>
        )}

        <InteractiveTable
          columns={columns}
          data={runs}
          getRowId={(run: Run) => String(run.id)}
          renderExpandedRow={(run: Run) => (
            <RunDetails
              runId={run.id}
              version={`${run.state}/${run.try_number}/${run.last_attempt?.state ?? ''}`}
              onChanged={load}
            />
          )}
        />

        <Stack gap={1} justifyContent="flex-end">
          <Button
            size="sm"
            variant="secondary"
            icon="angle-left"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Newer
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="angle-right"
            disabled={runs.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Older
          </Button>
        </Stack>
      </Stack>
    </PluginPage>
  );
}

export default Runs;
