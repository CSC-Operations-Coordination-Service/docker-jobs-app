import React, { useState } from 'react';
import { Button, IconButton, Input, Stack, Text, TextArea } from '@grafana/ui';

import { splitCommandLine } from '../../utils';

interface Props {
  /** what the rows are, for labels: "argument", "variable"... */
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  /** offer a box that splits a pasted command line into rows */
  paste?: boolean;
}

/**
 * One string per row -- one argument each, exactly what the container gets:
 * the backend runs commands exec-style, without a shell.
 */
export function StringListEditor({ label, value, onChange, paste = false }: Props) {
  const [line, setLine] = useState('');
  const [error, setError] = useState<string>();

  const set = (index: number, item: string) => onChange(value.map((old, i) => (i === index ? item : old)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const split = () => {
    try {
      onChange(splitCommandLine(line));
      setLine('');
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Stack direction="column" gap={1}>
      {value.map((item, index) => (
        <Stack key={index} gap={1} alignItems="center">
          <Input
            aria-label={`${label} ${index + 1}`}
            value={item}
            onChange={(event) => set(index, event.currentTarget.value)}
          />
          <IconButton name="trash-alt" tooltip={`Remove ${label} ${index + 1}`} onClick={() => remove(index)} />
        </Stack>
      ))}
      <div>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => onChange([...value, ''])}>
          Add {label}
        </Button>
      </div>
      {paste && (
        <Stack gap={1} alignItems="center">
          {/* a TextArea: a single-line input would drop the newlines of a
              command copied from a script, and leave its \ continuations as arguments */}
          <TextArea
            rows={2}
            aria-label={`Paste a command line into ${label}s`}
            placeholder='--start "{{ data_interval_start | iso_ms }}" --verbose'
            value={line}
            onChange={(event) => setLine(event.currentTarget.value)}
          />
          <Button size="sm" variant="secondary" disabled={!line.trim()} onClick={split}>
            Split into {label}s
          </Button>
        </Stack>
      )}
      {error && (
        <Text color="error" variant="bodySmall">
          {error}
        </Text>
      )}
    </Stack>
  );
}
