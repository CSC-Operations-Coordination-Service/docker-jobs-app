import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  BadgeColor,
  Button,
  CellProps,
  Checkbox,
  Column,
  InteractiveTable,
  LoadingPlaceholder,
  Modal,
  Stack,
  Text,
} from '@grafana/ui';

import { JobCreate, createJob, errorMessage, listJobs, previewJob, updateJob } from '../../api';
import { ImportItem, ImportStatus, planImport } from '../../jobsFile';

type Cell = CellProps<ImportItem>;

const STATUS_COLOR: Record<ImportStatus, BadgeColor> = {
  new: 'blue',
  changed: 'orange',
  unchanged: 'darkgrey',
  invalid: 'red',
};

export interface ImportResult {
  /** what was saved: "2 created, 1 updated" */
  notice?: string;
  /** what was not, and why */
  error?: string;
}

interface Props {
  /** the definitions of the file, as parseJobsFile read them */
  definitions: JobCreate[];
  onDismiss: () => void;
  onDone: (result: ImportResult) => void;
}

/**
 * The import of a jobs file: each job checked by the backend and compared
 * with the stored one, then -- once confirmed -- the ticked ones saved. New
 * jobs start ticked; overwriting a changed one is a choice.
 */
export function ImportJobs({ definitions, onDismiss, onDone }: Props) {
  const [items, setItems] = useState<ImportItem[]>();
  const [error, setError] = useState<string>();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const planned = await planImport(
          definitions,
          await listJobs(),
          async (job) => (await previewJob(job)).problems
        );
        if (current) {
          setItems(planned);
          setTicked(new Set(planned.filter((item) => item.status === 'new').map((item) => item.definition.name)));
        }
      } catch (err) {
        if (current) {
          setError(errorMessage(err));
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [definitions]);

  const toggle = (name: string) =>
    setTicked((before) => {
      const after = new Set(before);
      after.has(name) ? after.delete(name) : after.add(name);
      return after;
    });

  const save = async () => {
    setSaving(true);
    let created = 0;
    let updated = 0;
    const failures: string[] = [];

    // one at a time: each answer is reported as it is, nothing else depends on it
    for (const item of items ?? []) {
      const { name, ...spec } = item.definition;
      if (!ticked.has(name)) {
        continue;
      }
      try {
        if (item.status === 'new') {
          await createJob(item.definition);
          created += 1;
        } else {
          await updateJob(name, spec);
          updated += 1;
        }
      } catch (err) {
        failures.push(`${name}: ${errorMessage(err)}`);
      }
    }

    const done = [created && `${created} created`, updated && `${updated} updated`].filter(Boolean).join(', ');
    onDone({
      notice: done || undefined,
      error: failures.length ? `${failures.length} failed: ${failures.join('; ')}` : undefined,
    });
  };

  const columns = useMemo<Array<Column<ImportItem>>>(
    () => [
      {
        id: 'tick',
        header: '',
        cell: ({ row }: Cell) => {
          const { status, definition } = row.original;
          return status === 'new' || status === 'changed' ? (
            <Checkbox
              aria-label={`Import ${definition.name}`}
              value={ticked.has(definition.name)}
              onChange={() => toggle(definition.name)}
            />
          ) : null;
        },
      },
      { id: 'name', header: 'Job', cell: ({ row }: Cell) => row.original.definition.name },
      {
        id: 'status',
        header: 'In the file',
        cell: ({ row }: Cell) => <Badge text={row.original.status} color={STATUS_COLOR[row.original.status]} />,
      },
      {
        id: 'details',
        header: '',
        cell: ({ row }: Cell) => {
          const { changes, error: why, warnings } = row.original;
          return (
            <Stack direction="column" gap={0}>
              {changes.length > 0 && <span>changes {changes.join(', ')}</span>}
              {why && <Text color="error">{why}</Text>}
              {warnings.map((warning) => (
                <Text key={warning} color="warning">
                  {warning}
                </Text>
              ))}
            </Stack>
          );
        },
      },
    ],
    [ticked]
  );

  const count = ticked.size;

  return (
    <Modal title="Import jobs" isOpen onDismiss={onDismiss}>
      {error ? (
        <Alert severity="error" title="Cannot compare the file with the jobs">
          {error}
        </Alert>
      ) : items ? (
        <InteractiveTable
          columns={columns}
          data={items}
          // by position: a file may name a job twice
          getRowId={(item: ImportItem) => String(items.indexOf(item))}
          pageSize={100}
        />
      ) : (
        <LoadingPlaceholder text={`Checking ${definitions.length} jobs...`} />
      )}
      <Modal.ButtonRow>
        <Button variant="secondary" fill="outline" onClick={onDismiss}>
          Cancel
        </Button>
        <Button disabled={!items || count === 0 || saving} icon={saving ? 'spinner' : 'cloud-upload'} onClick={save}>
          {`Import ${count} ${count === 1 ? 'job' : 'jobs'}`}
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}
