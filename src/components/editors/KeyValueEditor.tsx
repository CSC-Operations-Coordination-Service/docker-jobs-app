import React, { useState } from 'react';
import { Button, IconButton, Input, Stack } from '@grafana/ui';

interface Props {
  /** what the keys are, for labels: "variable", "param" */
  label: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

type Row = { key: string; value: string };

/**
 * Key/value rows. The rows are this editor's own state -- a key being retyped,
 * or two rows with the same key, must not collapse while editing; the parent
 * gets the dict they make, rows without a key left out, the last duplicate
 * winning.
 */
export function KeyValueEditor({ label, value, onChange }: Props) {
  const [rows, setRows] = useState<Row[]>(() => Object.entries(value).map(([key, item]) => ({ key, value: item })));

  const update = (next: Row[]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])));
  };
  const set = (index: number, change: Partial<Row>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <Stack direction="column" gap={1}>
      {rows.map((row, index) => (
        <Stack key={index} gap={1} alignItems="center">
          <Input
            aria-label={`${label} ${index + 1} name`}
            placeholder="NAME"
            width={30}
            value={row.key}
            onChange={(event) => set(index, { key: event.currentTarget.value })}
          />
          <Input
            aria-label={`${label} ${index + 1} value`}
            placeholder="value, or a template"
            value={row.value}
            onChange={(event) => set(index, { value: event.currentTarget.value })}
          />
          <IconButton
            name="trash-alt"
            tooltip={`Remove ${label} ${index + 1}`}
            onClick={() => update(rows.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <div>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => update([...rows, { key: '', value: '' }])}>
          Add {label}
        </Button>
      </div>
    </Stack>
  );
}
