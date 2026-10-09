import { aJob } from './test-fixtures';
import { fetchError } from './test-utils';
import { changedFields, exportFileName, exportJobs, parseJobsFile, planImport, readText } from './jobsFile';
import { emptyJob, jobToSpec } from './utils';
import type { Job, JobCreate } from './api';

const NOW = new Date('2026-10-09T12:30:00Z');

/** a job as a file holds it: its definition, named */
const definitionOf = (job: Job): JobCreate => ({ name: job.name, ...jobToSpec(job) });

describe('exportJobs', () => {
  const jobs = [aJob({ name: 'recollect', retries: 2 }), aJob({ name: 'collect' })];

  it('writes the definitions of the jobs, by name, under jobs:', () => {
    const text = exportJobs(jobs, NOW);

    expect(text.startsWith('# docker-jobs export, 2026-10-09T12:30:00.000Z')).toBe(true);
    expect(text).toMatch(/^jobs:\n {2}- name: collect\n/m);
    expect(text.indexOf('name: collect')).toBeLessThan(text.indexOf('name: recollect'));
  });

  it('leaves out what the backend computes', () => {
    const text = exportJobs(jobs, NOW);

    for (const computed of ['next_fire_at', 'schedule_cursor', 'created_at', 'updated_at', 'updated_by']) {
      expect(text).not.toContain(computed);
    }
  });

  it('reads back as the same definitions', () => {
    expect(parseJobsFile(exportJobs(jobs, NOW))).toEqual([definitionOf(jobs[1]), definitionOf(jobs[0])]);
  });

  it('keeps a template, a cron with stars and string ids intact', () => {
    const job = aJob({
      schedule: '* * * * *',
      env: { DEBUG: 'true', RETRIES: '3' },
      secrets: [{ source: 'cdse', target: '', uid: '10001', gid: '10001', mode: 0o400 }],
    });

    expect(parseJobsFile(exportJobs([job], NOW))).toEqual([definitionOf(job)]);
  });

  it('names the file after the moment, in UTC', () => {
    expect(exportFileName(NOW)).toBe('docker-jobs-20261009-1230.yaml');
  });
});

describe('parseJobsFile', () => {
  it('completes a definition with the defaults of a new job', () => {
    const [definition] = parseJobsFile('jobs:\n  - name: hello\n    image: alpine\n    schedule: "0 1 * * *"\n');

    const { schedule, ...defaults } = emptyJob();
    expect(definition).toEqual({ ...defaults, name: 'hello', image: 'alpine', schedule: '0 1 * * *' });
  });

  it('never makes up a schedule', () => {
    const [definition] = parseJobsFile('jobs:\n  - name: hello\n    image: alpine\n');

    expect(definition.schedule).toBeUndefined();
  });

  it('takes a bare list of jobs', () => {
    expect(parseJobsFile('- name: a\n- name: b\n').map((job) => job.name)).toEqual(['a', 'b']);
  });

  it('takes JSON', () => {
    expect(parseJobsFile('{"jobs": [{"name": "a", "retries": 2}]}')[0]).toMatchObject({ name: 'a', retries: 2 });
  });

  it('keeps unknown fields, for the backend to refuse', () => {
    expect(parseJobsFile('jobs:\n  - name: a\n    retry: 2\n')[0]).toMatchObject({ retry: 2 });
  });

  it.each([
    ['jobs: [name: a', /flow sequence|missing/i],
    ['name: a\nimage: alpine\n', /a jobs: list/],
    ['', /a jobs: list/],
    ['jobs:\n  - just-a-string\n', /job 1 is not a mapping/],
    ['jobs:\n  - name: a\n  - image: alpine\n', /job 2 has no name/],
  ])('refuses %j', (text, why) => {
    expect(() => parseJobsFile(text)).toThrow(why);
  });
});

describe('changedFields', () => {
  it('finds no change in the same definition', () => {
    expect(changedFields(aJob(), definitionOf(aJob()))).toEqual([]);
  });

  it('lists the fields that differ', () => {
    const imported = { ...definitionOf(aJob()), image: 'maas-collector:3.11.0', retries: 2 };

    expect(changedFields(aJob(), imported)).toEqual(['image', 'retries']);
  });

  it('sees through what the backend normalises', () => {
    const stored = aJob({
      schedule: '0 1 * * *',
      env: { A: '1', B: '2' },
      secrets: [{ source: 'cdse', target: '', uid: '10001', gid: '10001', mode: 0o400 }],
      configs: [{ source: 'conf', target: '/conf.json', uid: '10001', gid: '10001', mode: 0o444 }],
      mounts: [{ type: 'volume', source: 'work', target: '/work', read_only: false }],
    });
    const imported = {
      ...definitionOf(stored),
      schedule: '0  1 * *  *',
      start_date: '2026-10-09T02:00:00+02:00',
      env: { B: '2', A: '1' },
      secrets: [{ source: 'cdse' }],
      configs: [{ source: 'conf', target: '/conf.json' }],
      mounts: [{ target: '/work', source: 'work' }],
    } as unknown as JobCreate;

    expect(changedFields(stored, imported)).toEqual([]);
  });

  it('does not count a missing start date: the job keeps its own', () => {
    expect(changedFields(aJob(), { ...definitionOf(aJob()), start_date: null })).toEqual([]);
  });
});

describe('planImport', () => {
  const valid = jest.fn(async () => [] as string[]);

  beforeEach(() => valid.mockClear());

  it('sorts the definitions into new, changed and unchanged', async () => {
    const stored = [aJob({ name: 'same' }), aJob({ name: 'edited' })];
    const definitions = [
      definitionOf(aJob({ name: 'brand-new' })),
      definitionOf(aJob({ name: 'same' })),
      definitionOf(aJob({ name: 'edited', timeout_seconds: 7200 })),
    ];

    const items = await planImport(definitions, stored, valid, NOW);

    expect(items.map((item) => [item.definition.name, item.status, item.changes])).toEqual([
      ['brand-new', 'new', []],
      ['same', 'unchanged', []],
      ['edited', 'changed', ['timeout_seconds']],
    ]);
    expect(valid).toHaveBeenCalledTimes(3);
  });

  it("is invalid where the backend says so, with the backend's reason", async () => {
    const refuse = jest
      .fn()
      .mockRejectedValue(fetchError({ detail: [{ loc: ['body', 'job', 'schedule'], msg: 'Field required' }] }));

    const [item] = await planImport([definitionOf(aJob())], [], refuse, NOW);

    expect(item.status).toBe('invalid');
    expect(item.error).toBe('job.schedule: Field required');
  });

  it('is invalid for a name the file holds twice', async () => {
    const twice = [definitionOf(aJob()), definitionOf(aJob({ retries: 1 }))];

    const items = await planImport(twice, [], valid, NOW);

    expect(items.map((item) => [item.status, item.error])).toEqual([
      ['invalid', 'collect is in the file 2 times'],
      ['invalid', 'collect is in the file 2 times'],
    ]);
    expect(valid).not.toHaveBeenCalled();
  });

  it("warns of what the swarm lacks for the job's launch", async () => {
    const missing = jest.fn(async () => ["secret 'cdse' does not exist"]);

    const [item] = await planImport([{ ...definitionOf(aJob()), start_date: null }], [], missing, NOW);

    expect(item.status).toBe('new');
    expect(item.warnings).toEqual(["secret 'cdse' does not exist"]);
  });

  it('warns that a new job catching up from a past start date runs every interval since', async () => {
    const definition = definitionOf(aJob({ start_date: '2026-10-01T00:00:00Z', catchup: true }));

    const [item] = await planImport([definition], [], valid, NOW);

    expect(item.warnings).toEqual(['catches up every interval since 2026-10-01 00:00:00']);
  });

  it.each([
    ['without catch-up', { start_date: '2026-10-01T00:00:00Z', catchup: false }],
    ['without a start date', { start_date: null, catchup: true }],
    ['from a future start date', { start_date: '2026-11-01T00:00:00Z', catchup: true }],
  ])('has nothing to catch up %s', async (_, overrides) => {
    const definition = { ...definitionOf(aJob()), ...overrides };

    const [item] = await planImport([definition], [], valid, NOW);

    expect(item.warnings).toEqual([]);
  });

  it('does not warn of catching up for a job that exists: its cursor stays', async () => {
    const definition = definitionOf(aJob({ start_date: '2026-10-01T00:00:00Z' }));

    const [item] = await planImport([definition], [aJob()], valid, NOW);

    expect(item.warnings).toEqual([]);
  });
});

describe('readText', () => {
  it('reads a file the browser gave', async () => {
    expect(await readText(new File(['jobs: []'], 'jobs.yaml'))).toBe('jobs: []');
  });
});
