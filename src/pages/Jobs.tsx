import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  ConfirmModal,
  Field,
  FileUpload,
  InlineField,
  InlineSwitch,
  Input,
  InteractiveTable,
  LinkButton,
  Stack,
  TextLink,
} from '@grafana/ui';

import {
  Job,
  JobCreate,
  Run,
  deleteJob,
  errorMessage,
  getJob,
  listJobs,
  listRuns,
  triggerJob,
  updateJob,
} from '../api';
import { ImportJobs, ImportResult } from '../components/ImportJobs/ImportJobs';
import { ROUTES, prefixRoute } from '../constants';
import { JOBS_FILE_ACCEPT, download, exportFileName, exportJobs, parseJobsFile, readText } from '../jobsFile';
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
  // two errors: a reload must not wipe out why an action failed
  const [loadError, setLoadError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pending, setPending] = useState<Pending>();
  const [runDate, setRunDate] = useState('');
  const [runNote, setRunNote] = useState('');
  // the definitions of the file being imported
  const [importing, setImporting] = useState<JobCreate[]>();

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
      setLoadError(undefined);
    } catch (err) {
      setLoadError(errorMessage(err));
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
        setActionError(undefined);
      } catch (err) {
        setNotice(undefined);
        setActionError(errorMessage(err));
      }
      load();
    },
    [load]
  );

  const toggle = useCallback(
    (job: Row) =>
      act(async () => {
        // PUT replaces the whole definition: start from the stored one, not
        // from a row that may predate someone else's edit
        const fresh = await getJob(job.name);
        await updateJob(job.name, { ...jobToSpec(fresh), enabled: !fresh.enabled });
        return `${job.name} ${fresh.enabled ? 'disabled' : 'enabled'}`;
      }),
    [act]
  );

  const exportAll = () =>
    act(async () => {
      // the stored definitions, not the rows: they may be a refresh old
      const jobs = await listJobs();
      const fileName = exportFileName();
      download(fileName, exportJobs(jobs));
      return `${jobs.length} jobs exported to ${fileName}`;
    });

  const openFile = async (event: React.SyntheticEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      setImporting(parseJobsFile(await readText(file)));
      setActionError(undefined);
    } catch (err) {
      setActionError(`${file.name}: ${errorMessage(err)}`);
    } finally {
      // so that choosing the same file again, once fixed, reads it again
      input.value = '';
    }
  };

  const imported = (result: ImportResult) => {
    setImporting(undefined);
    setNotice(result.notice);
    setActionError(result.error);
    load();
  };

  const ask = (action: Pending['action'], job: Row) => {
    setRunDate('');
    setRunNote('');
    setPending({ action, job });
  };

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
      const run = await triggerJob(job.name, runDate.trim() || undefined, runNote.trim());
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
                  onClick={() => ask('run', row.original)}
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
                  onClick={() => ask('delete', row.original)}
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
          <Stack gap={1} alignItems="center">
            <Button variant="secondary" icon="download-alt" onClick={exportAll}>
              Export
            </Button>
            {editable && (
              <>
                <FileUpload accept={JOBS_FILE_ACCEPT} onFileUpload={openFile}>
                  Import
                </FileUpload>
                <LinkButton href={prefixRoute(`${ROUTES.Jobs}/new`)} icon="plus">
                  New job
                </LinkButton>
              </>
            )}
          </Stack>
        </Stack>

        {loadError && (
          <Alert severity="error" title="Cannot load the jobs">
            {loadError}
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" title="Not done" onRemove={() => setActionError(undefined)}>
            {actionError}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" title="Done" onRemove={() => setNotice(undefined)}>
            {notice}
          </Alert>
        )}

        <InteractiveTable columns={columns} data={rows} getRowId={(row: Row) => row.name} pageSize={50} />
      </Stack>

      {importing && <ImportJobs definitions={importing} onDismiss={() => setImporting(undefined)} onDone={imported} />}

      <ConfirmModal
        isOpen={pending !== undefined}
        title={pending?.action === 'delete' ? `Delete ${pending.job.name}?` : `Run ${pending?.job.name} now?`}
        body={
          pending?.action === 'delete' ? (
            'The job and every run of it are deleted. Its logs stay in Loki.'
          ) : (
            <Stack direction="column" gap={1}>
              A manual run, recorded under your name: of the interval a date falls in -- one never run, say -- or of the
              latest ended interval.
              <Field label="A date in the interval" description="ISO 8601 with a timezone; empty: the latest ended">
                <Input
                  id="run-now-date"
                  placeholder="2026-10-09T00:30:00Z"
                  value={runDate}
                  onChange={(event) => setRunDate(event.currentTarget.value)}
                />
              </Field>
              <Field label="Note" description="Why: recorded with your name">
                <Input id="run-now-note" value={runNote} onChange={(event) => setRunNote(event.currentTarget.value)} />
              </Field>
            </Stack>
          )
        }
        confirmText={pending?.action === 'delete' ? 'Delete' : 'Run'}
        onConfirm={confirm}
        onDismiss={() => setPending(undefined)}
      />
    </PluginPage>
  );
}

export default Jobs;
