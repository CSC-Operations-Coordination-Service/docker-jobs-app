import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { KeyValueEditor } from './KeyValueEditor';
import { RowsEditor } from './RowsEditor';
import { StringListEditor } from './StringListEditor';

/** an editor with its value held like a page would, the last value seen */
function Holder<T>({
  initial,
  editor,
}: {
  initial: T;
  editor: (value: T, onChange: (v: T) => void) => React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      {editor(value, setValue)}
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const value = () => JSON.parse(screen.getByTestId('value').textContent!);

describe('StringListEditor', () => {
  it('splits a pasted command line into one row per argument', () => {
    render(
      <Holder<string[]>
        initial={[]}
        editor={(v, onChange) => <StringListEditor label="argument" value={v} onChange={onChange} paste />}
      />
    );

    fireEvent.change(screen.getByLabelText('Paste a command line into arguments'), {
      target: { value: 'python -m mod --start {{ data_interval_start | iso_ms }}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split into arguments' }));

    expect(value()).toEqual(['python', '-m', 'mod', '--start', '{{ data_interval_start | iso_ms }}']);
    expect(screen.getByLabelText('argument 5')).toHaveValue('{{ data_interval_start | iso_ms }}');
  });

  it('says what is wrong with a line it cannot split', () => {
    render(
      <Holder<string[]>
        initial={['keep']}
        editor={(v, onChange) => <StringListEditor label="argument" value={v} onChange={onChange} paste />}
      />
    );

    fireEvent.change(screen.getByLabelText('Paste a command line into arguments'), { target: { value: '"oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Split into arguments' }));

    expect(screen.getByText('unclosed "')).toBeInTheDocument();
    expect(value()).toEqual(['keep']);
  });

  it('adds and removes rows', () => {
    render(
      <Holder<string[]>
        initial={['a', 'b']}
        editor={(v, onChange) => <StringListEditor label="argument" value={v} onChange={onChange} />}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove argument 1' }));
    fireEvent.click(screen.getByRole('button', { name: /add argument/i }));

    expect(value()).toEqual(['b', '']);
  });
});

describe('KeyValueEditor', () => {
  it('builds the dict from its rows, keyless rows left out', () => {
    render(
      <Holder<Record<string, string>>
        initial={{ IFACE: '{{ params.interface }}' }}
        editor={(v, onChange) => <KeyValueEditor label="variable" value={v} onChange={onChange} />}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    fireEvent.change(screen.getByLabelText('variable 2 value'), { target: { value: 'half typed' } });
    expect(value()).toEqual({ IFACE: '{{ params.interface }}' });

    fireEvent.change(screen.getByLabelText('variable 2 name'), { target: { value: 'NOTE' } });
    expect(value()).toEqual({ IFACE: '{{ params.interface }}', NOTE: 'half typed' });
  });
});

describe('RowsEditor', () => {
  type Mount = { type: string; source: string; target: string; read_only: boolean };

  it('edits each field of a row', () => {
    render(
      <Holder<Mount[]>
        initial={[]}
        editor={(v, onChange) => (
          <RowsEditor<Mount>
            label="mount"
            rows={v}
            fields={[
              { key: 'source', label: 'source' },
              { key: 'target', label: 'target' },
              { key: 'read_only', label: 'read only', kind: 'bool' },
            ]}
            empty={() => ({ type: 'volume', source: '', target: '', read_only: false })}
            onChange={onChange}
          />
        )}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add mount/i }));
    fireEvent.change(screen.getByLabelText('mount 1 source'), { target: { value: 'dm-work' } });
    fireEvent.change(screen.getByLabelText('mount 1 target'), { target: { value: '/work' } });
    fireEvent.click(screen.getByLabelText('mount 1 read only'));

    expect(value()).toEqual([{ type: 'volume', source: 'dm-work', target: '/work', read_only: true }]);
  });
});
