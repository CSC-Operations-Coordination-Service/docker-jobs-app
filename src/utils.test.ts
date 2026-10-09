import { config } from '@grafana/runtime';

import { aJob } from './test-fixtures';
import {
  canEdit,
  exploreUrl,
  formatDate,
  formatInterval,
  isEnded,
  jobToSpec,
  splitCommandLine,
  stateColor,
} from './utils';

describe('formatDate', () => {
  it('shows UTC to the second, a dash for nothing, the value for garbage', () => {
    expect(formatDate('2026-10-09T01:02:03.456Z')).toBe('2026-10-09 01:02:03');
    expect(formatDate(null)).toBe('–');
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('formatInterval', () => {
  it('names the end date only when it differs', () => {
    expect(formatInterval('2026-10-09T00:00:00Z', '2026-10-09T01:00:00Z')).toBe('2026-10-09 00:00 → 01:00');
    expect(formatInterval('2026-10-08T13:00:00Z', '2026-10-09T01:00:00Z')).toBe('2026-10-08 13:00 → 2026-10-09 01:00');
  });
});

describe('states', () => {
  it('knows which runs have ended', () => {
    expect(['success', 'failed', 'cancelled'].every((state) => isEnded(state as never))).toBe(true);
    expect(['queued', 'running', 'retrying'].some((state) => isEnded(state as never))).toBe(false);
  });

  it('colours success green and failures red', () => {
    expect(stateColor('success')).toBe('green');
    expect(stateColor('failed')).toBe('red');
    expect(stateColor('lost')).toBe('red');
  });
});

describe('splitCommandLine', () => {
  it('splits on spaces and keeps quoted text together', () => {
    expect(splitCommandLine(`python -m mod --name "two words" --x 'a b' c\\ d`)).toEqual([
      'python',
      '-m',
      'mod',
      '--name',
      'two words',
      '--x',
      'a b',
      'c d',
    ]);
  });

  it('never splits a template, spaces and all', () => {
    expect(
      splitCommandLine(
        '--start {{ data_interval_start | iso_ms }} --end={{ (data_interval_end - timedelta(days=1)) | iso_ms }}'
      )
    ).toEqual([
      '--start',
      '{{ data_interval_start | iso_ms }}',
      '--end={{ (data_interval_end - timedelta(days=1)) | iso_ms }}',
    ]);
  });

  it('keeps an empty quoted argument and unescapes inside double quotes', () => {
    expect(splitCommandLine(`--note "" "say \\"hi\\""`)).toEqual(['--note', '', 'say "hi"']);
  });

  it('refuses an unclosed quote or template', () => {
    expect(() => splitCommandLine('--name "oops')).toThrow('unclosed "');
    expect(() => splitCommandLine('--start {{ data_interval_start')).toThrow('unclosed template {{');
  });

  it('gives nothing for blank text', () => {
    expect(splitCommandLine('   ')).toEqual([]);
  });
});

describe('exploreUrl', () => {
  it('opens the selector in Explore from a minute before to a minute after', () => {
    const url = exploreUrl(
      'loki-uid',
      '{swarm_service="djobs_collect_7_1"}',
      '2026-10-09T01:00:00Z',
      '2026-10-09T01:02:00Z'
    );

    const panes = JSON.parse(new URLSearchParams(url.split('?')[1]).get('panes')!);
    expect(url.startsWith('/explore?schemaVersion=1&panes=')).toBe(true);
    expect(panes.logs.datasource).toBe('loki-uid');
    expect(panes.logs.queries[0].expr).toBe('{swarm_service="djobs_collect_7_1"}');
    expect(panes.logs.range).toEqual({
      from: String(Date.parse('2026-10-09T00:59:00Z')),
      to: String(Date.parse('2026-10-09T01:03:00Z')),
    });
  });

  it('runs to now for an attempt still running', () => {
    const url = exploreUrl('loki-uid', '{}', '2026-10-09T01:00:00Z', null);
    expect(JSON.parse(new URLSearchParams(url.split('?')[1]).get('panes')!).logs.range.to).toBe('now');
  });
});

describe('jobToSpec', () => {
  it('keeps the definition and drops what the backend computed', () => {
    const spec = jobToSpec(aJob());

    expect(spec).not.toHaveProperty('name');
    expect(spec).not.toHaveProperty('next_fire_at');
    expect(spec).not.toHaveProperty('created_at');
    expect(spec).not.toHaveProperty('schedule_cursor');
    expect(spec.command).toEqual(['--start', '{{ data_interval_start | iso_ms }}']);
    expect(spec.start_date).toBe('2026-10-09T00:00:00Z');
  });
});

describe('canEdit', () => {
  afterEach(() => {
    config.bootData.user = {} as never;
  });

  it('lets Editors, Admins and Grafana admins edit, not Viewers', () => {
    config.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: false } as never;
    expect(canEdit()).toBe(false);
    config.bootData.user = { orgRole: 'Editor', isGrafanaAdmin: false } as never;
    expect(canEdit()).toBe(true);
    config.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: true } as never;
    expect(canEdit()).toBe(true);
  });
});
