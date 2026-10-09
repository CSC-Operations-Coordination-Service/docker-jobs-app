import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Badge,
  Button,
  CellProps,
  Column,
  ConfirmModal,
  Field,
  Input,
  InteractiveTable,
  LoadingPlaceholder,
  Stack,
  TextLink,
  useStyles2,
} from '@grafana/ui';

import { Attempt, Run, cancelRun, errorMessage, getRun, rerunRun } from '../api';
import { Truncated } from '../components/Truncated/Truncated';
import { useAppSettings } from '../settings';
import { canEdit, exploreUrl, formatDate, formatInterval, isEnded, stateColor } from '../utils';

type Cell = CellProps<Attempt>;

interface Props {
  runId: number;
  /** after a rerun or a cancel, so a list showing the run can reload */
  onChanged?: () => void;
}

/** One run: its attempts, where their logs are, and -- for Editors -- rerun or cancel. */
export function RunDetails({ runId, onChanged }: Props) {
  const styles = useStyles2(getStyles);
  const { lokiDatasourceUid } = useAppSettings();
  const editable = canEdit();
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();
  const [action, setAction] = useState<'rerun' | 'cancel'>();
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setRun(await getRun(runId));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<Array<Column<Attempt>>>(
    () => [
      { id: 'try_number', header: 'Try' },
      { id: 'reason', header: 'Why' },
      {
        id: 'state',
        header: 'State',
        cell: ({ row }: Cell) => <Badge text={row.original.state} color={stateColor(row.original.state)} />,
      },
      { id: 'launched_at', header: 'Launched (UTC)', cell: ({ row }: Cell) => formatDate(row.original.launched_at) },
      { id: 'finished_at', header: 'Ended (UTC)', cell: ({ row }: Cell) => formatDate(row.original.finished_at) },
      { id: 'exit_code', header: 'Exit', cell: ({ row }: Cell) => row.original.exit_code ?? '–' },
      {
        id: 'node_id',
        header: 'Node',
        cell: ({ row }: Cell) => <Truncated text={row.original.node_id ?? ''} maxWidth={120} />,
      },
      {
        id: 'error',
        header: 'Error',
        cell: ({ row }: Cell) => <Truncated text={row.original.error ?? ''} maxWidth={320} />,
      },
      {
        id: 'logs',
        header: 'Logs',
        cell: ({ row }: Cell) =>
          lokiDatasourceUid && row.original.loki_selector ? (
            <TextLink
              href={exploreUrl(
                lokiDatasourceUid,
                row.original.loki_selector,
                row.original.launched_at,
                row.original.finished_at
              )}
              external
            >
              Logs
            </TextLink>
          ) : (
            '–'
          ),
      },
    ],
    [lokiDatasourceUid]
  );

  if (!run) {
    return error ? <Alert title="Cannot load the run">{error}</Alert> : <LoadingPlaceholder text="Loading..." />;
  }

  const confirm = async () => {
    const what = action;
    setAction(undefined);
    try {
      setRun(what === 'rerun' ? await rerunRun(run.id, note) : await cancelRun(run.id, note));
      setNote('');
      setError(undefined);
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const attempts = run.attempts ?? [];
  const last = attempts[attempts.length - 1];

  return (
    <div className={styles.details}>
      {error && (
        <Alert severity="error" title={`Run ${run.id}`} onRemove={() => setError(undefined)}>
          {error}
        </Alert>
      )}
      <dl>
        <dt>Run</dt>
        <dd>
          {run.id} of {run.job}, {run.run_type}
        </dd>
        <dt>Interval (UTC)</dt>
        <dd>{formatInterval(run.data_interval_start, run.data_interval_end)}</dd>
        <dt>State</dt>
        <dd>
          <Badge text={run.state} color={stateColor(run.state)} /> try {run.try_number} of {run.max_tries}
        </dd>
        {run.requested_by && (
          <>
            <dt>Asked by</dt>
            <dd>
              {run.requested_by}
              {run.note && `: ${run.note}`}
            </dd>
          </>
        )}
        {last?.rendered_command && (
          <>
            <dt>Command</dt>
            <dd>
              <code>{JSON.stringify([...(last.rendered_entrypoint ?? []), ...last.rendered_command])}</code>
            </dd>
          </>
        )}
      </dl>

      <InteractiveTable columns={columns} data={attempts} getRowId={(attempt: Attempt) => String(attempt.try_number)} />

      {editable && (
        <Stack gap={1}>
          {isEnded(run.state) ? (
            <Button size="sm" icon="history" onClick={() => setAction('rerun')}>
              Rerun
            </Button>
          ) : (
            <Button size="sm" variant="destructive" icon="times" onClick={() => setAction('cancel')}>
              Cancel run
            </Button>
          )}
        </Stack>
      )}

      <ConfirmModal
        isOpen={action !== undefined}
        title={action === 'rerun' ? `Rerun run ${run.id}?` : `Cancel run ${run.id}?`}
        body={
          <Stack direction="column" gap={1}>
            {action === 'rerun'
              ? `A new attempt of ${run.job} over the same interval, with the job's retries afresh.`
              : 'Its pending attempt is dropped, or its running service removed.'}
            <Field label="Note" description="Why: recorded with your name">
              <Input id="run-action-note" value={note} onChange={(event) => setNote(event.currentTarget.value)} />
            </Field>
          </Stack>
        }
        confirmText={action === 'rerun' ? 'Rerun' : 'Cancel run'}
        confirmVariant={action === 'rerun' ? 'primary' : 'destructive'}
        onConfirm={confirm}
        onDismiss={() => setAction(undefined)}
      />
    </div>
  );
}

/** /runs/:id, a run on its own page: what a link to one run opens. */
export function RunPage() {
  const { id } = useParams();
  return (
    <PluginPage>
      <RunDetails runId={Number(id)} />
    </PluginPage>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  details: css({
    padding: theme.spacing(1, 2),
    dl: {
      display: 'grid',
      gridTemplateColumns: 'max-content auto',
      columnGap: theme.spacing(2),
      rowGap: theme.spacing(0.5),
      marginBottom: theme.spacing(2),
    },
    dt: { color: theme.colors.text.secondary },
  }),
});

export default RunPage;
