import React from 'react';
import { Button, Checkbox, IconButton, Input, RadioButtonGroup, Stack } from '@grafana/ui';

/** One column of a RowsEditor. */
export interface RowField<T> {
  key: keyof T & string;
  label: string;
  kind?: 'text' | 'bool' | 'choice';
  choices?: string[];
  placeholder?: string;
  width?: number;
}

interface Props<T> {
  /** what a row is, for labels: "secret", "mount" */
  label: string;
  rows: T[];
  fields: Array<RowField<T>>;
  /** a new row */
  empty: () => T;
  onChange: (rows: T[]) => void;
}

/** Rows of a few fields each: the job's secrets, configs and mounts. */
export function RowsEditor<T extends object>({ label, rows, fields, empty, onChange }: Props<T>) {
  const set = (index: number, key: keyof T, item: unknown) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: item } : row)));

  return (
    <Stack direction="column" gap={1}>
      {rows.map((row, index) => (
        <Stack key={index} gap={1} alignItems="center">
          {fields.map((field) => {
            const name = `${label} ${index + 1} ${field.label}`;
            const current = row[field.key] as unknown;
            if (field.kind === 'bool') {
              return (
                <Checkbox
                  key={field.key}
                  aria-label={name}
                  label={field.label}
                  value={Boolean(current)}
                  onChange={(event) => set(index, field.key, event.currentTarget.checked)}
                />
              );
            }
            if (field.kind === 'choice') {
              return (
                <RadioButtonGroup
                  key={field.key}
                  aria-label={name}
                  options={(field.choices ?? []).map((choice) => ({ label: choice, value: choice }))}
                  value={String(current)}
                  onChange={(choice) => set(index, field.key, choice)}
                />
              );
            }
            return (
              <Input
                key={field.key}
                aria-label={name}
                placeholder={field.placeholder ?? field.label}
                width={field.width}
                value={String(current ?? '')}
                onChange={(event) => set(index, field.key, event.currentTarget.value)}
              />
            );
          })}
          <IconButton
            name="trash-alt"
            tooltip={`Remove ${label} ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      <div>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => onChange([...rows, empty()])}>
          Add {label}
        </Button>
      </div>
    </Stack>
  );
}
