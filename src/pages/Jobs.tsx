import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  ConfirmModal,
  InlineField,
  InlineSwitch,
  InteractiveTable,
  LinkButton,
  Stack,
  TextLink,
} from '@grafana/ui';

import { Job, Run, deleteJob, errorMessage, listJobs, listRuns, triggerJob, updateJob } from '../api';
import { ROUTES, prefixRoute } from '../constants';
import { canEdit, formatDate, formatInterval, jobToSpec, stateColor } from '../utils';

const REFRESH_MS = 15000;

/** A job and its newest run, if it has one. */
type Row = Job & { lastRun?: Run };

type Cell = CellProps<Row>;

type Pending = { action: 'run' | 'delete'; job: Row };

export const editRoute = (name: string) => prefixRoute(`${ROUTES.Jobs}/${encodeURIComponent(name)}/edit`);
export const runsRoute = (name: string) => `${prefixRoute(ROUTES.Runs)}?job=${encodeURIComponent(name)}`;

/** Every job, its schedule and its newest run; for Editors, the actions on it. */
export function Jobs() {
  const editable = canEdit();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pending, setPending] = useState<Pending>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const jobs = await listJobs();
      // one small request per job: its newest run
      const lastRuns = await Promise.all(
        jobs.map((job) =>
          listRuns({ job: job.name, size: 1 })
            .then((runs) => runs[0])
            .catch(() => undefined)
        )
      );
      setRows(jobs.map((job, index) => ({ ...job, lastRun: lastRuns[index] })));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!autoRefresh) {
      return undefined;
    }
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, autoRefresh]);

  const act = useCallback(
    async (what: () => Promise<string>) => {
      try {
        setNotice(await what());
        setError(undefined);
      } catch (err) {
        setError(errorMessage(err));
      }
      load();
    },
    [load]
  );

  const toggle = useCallback(
    (job: Row) =>
      act(async () => {
        await updateJob(job.name, { ...jobToSpec(job), enabled: !job.enabled });
        return `${job.name} ${job.enabled ? 'disabled' : 'enabled'}`;
      }),
    [act]
  );

  const confirm = () => {
    if (!pending) {
      return;
    }
    const { action, job } = pending;
    setPending(undefined);
    act(async () => {
      if (action === 'delete') {
        await deleteJob(job.name);
        return `${job.name} deleted, with its runs`;
      }
      const run = await triggerJob(job.name);
      return `Run ${run.id} of ${job.name} queued: ${formatInterval(run.data_interval_start, run.data_interval_end)}`;
    });
  };

  const columns = useMemo<Array<Column<Row>>>(
    () => [
      {
        id: 'name',
        header: 'Job',
        cell: ({ row }: Cell) =>
          editable ? (
            <TextLink href={editRoute(row.original.name)} inline={false}>
              {row.original.name}
            </TextLink>
          ) : (
            row.original.name
          ),
      },
      { id: 'schedule', header: 'Schedule (UTC)', cell: ({ row }: Cell) => <code>{row.original.schedule}</code> },
      {
        id: 'enabled',
        header: 'Status',
        cell: ({ row }: Cell) =>
          row.original.enabled ? <Badge text="enabled" color="green" /> : <Badge text="disabled" color="darkgrey" />,
      },
      { id: 'next_fire_at', header: 'Next run (UTC)', cell: ({ row }: Cell) => formatDate(row.original.next_fire_at) },
      {
        id: 'last_run',
        header: 'Last run',
        cell: ({ row }: Cell) => {
          const run = row.original.lastRun;
          return run ? (
            <Stack gap={1} alignItems="center">
              <Badge text={run.state} color={stateColor(run.state)} />
              {formatInterval(run.data_interval_start, run.data_interval_end)}
            </Stack>
          ) : (
            '–'
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }: Cell) => (
          <Stack gap={1} justifyContent="flex-end">
            <LinkButton size="sm" variant="secondary" href={runsRoute(row.original.name)}>
              Runs
            </LinkButton>
            {editable && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!row.original.enabled}
                  onClick={() => setPending({ action: 'run', job: row.original })}
                >
                  Run now
                </Button>
                <Button size="sm" variant="secondary" onClick={() => toggle(row.original)}>
                  {row.original.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  fill="text"
                  icon="trash-alt"
                  aria-label={`Delete ${row.original.name}`}
                  onClick={() => setPending({ action: 'delete', job: row.original })}
                />
              </>
            )}
          </Stack>
        ),
      },
    ],
    [editable, toggle]
  );

  return (
    <PluginPage>
      <Stack direction="column" gap={2}>
        <Stack justifyContent="space-between" wrap="wrap">
          <Stack gap={2} alignItems="center">
            <InlineField label="Auto refresh">
              <InlineSwitch value={autoRefresh} onChange={(event) => setAutoRefresh(event.currentTarget.checked)} />
            </InlineField>
            <Button variant="secondary" icon={loading ? 'spinner' : 'sync'} onClick={load}>
              Refresh
            </Button>
          </Stack>
          {editable && (
            <LinkButton href={prefixRoute(`${ROUTES.Jobs}/new`)} icon="plus">
              New job
            </LinkButton>
          )}
        </Stack>

        {error && (
          <Alert severity="error" title="Docker jobs" onRemove={() => setError(undefined)}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" title="Done" onRemove={() => setNotice(undefined)}>
            {notice}
          </Alert>
        )}

        <InteractiveTable columns={columns} data={rows} getRowId={(row: Row) => row.name} pageSize={50} />
      </Stack>

      <ConfirmModal
        isOpen={pending !== undefined}
        title={pending?.action === 'delete' ? `Delete ${pending.job.name}?` : `Run ${pending?.job.name} now?`}
        body={
          pending?.action === 'delete'
            ? 'The job and every run of it are deleted. Its logs stay in Loki.'
            : 'A manual run of its latest ended interval, recorded under your name.'
        }
        confirmText={pending?.action === 'delete' ? 'Delete' : 'Run'}
        onConfirm={confirm}
        onDismiss={() => setPending(undefined)}
      />
    </PluginPage>
  );
}

export default Jobs;
