import { parse, stringify } from 'yaml';

import { type Job, type JobCreate, type JobSpec, errorMessage } from './api';
import { emptyJob, formatDate, jobToSpec } from './utils';

// The jobs file: what Export writes and Import reads. YAML -- JSON is YAML too
// -- with the definitions of the jobs under `jobs:`, nothing the backend
// computed, so export -> edit -> import gives back what was written:
//
//   # docker-jobs export, 2026-10-09T12:30:00.000Z: 2 jobs
//   jobs:
//     - name: collect
//       image: 127.0.0.1:8085/maas-collector:3.10.1
//       schedule: 0 * * * *
//       ...

export const JOBS_FILE_ACCEPT = '.yaml,.yml,.json';

/** The file of these jobs: their definitions, by name. */
export function exportJobs(jobs: Job[], now: Date = new Date()): string {
  const definitions = [...jobs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((job) => ({ name: job.name, ...jobToSpec(job) }));
  const header = `# docker-jobs export, ${now.toISOString()}: ${definitions.length} jobs\n`;
  // lineWidth 0: a long command stays on one line
  return header + stringify({ jobs: definitions }, { lineWidth: 0 });
}

/** docker-jobs-20261009-1230.yaml */
export function exportFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `docker-jobs-${stamp}.yaml`;
}

/**
 * The definitions of a jobs file, each completed with the defaults a new job
 * gets -- except a schedule, which must be written. Fields the backend does
 * not know are kept, for it to refuse. Throws on a file that is not a jobs file.
 */
export function parseJobsFile(text: string): JobCreate[] {
  const document = parse(text);
  const entries: unknown = Array.isArray(document) ? document : document?.jobs;

  if (!Array.isArray(entries)) {
    throw new Error('not a jobs file: it needs a jobs: list');
  }
  const { schedule, ...defaults } = emptyJob();

  return entries.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`job ${index + 1} is not a mapping`);
    }
    if (typeof entry.name !== 'string' || !entry.name) {
      throw new Error(`job ${index + 1} has no name`);
    }
    return { ...defaults, ...entry } as JobCreate;
  });
}

/** The fields of the stored job the imported definition would change. */
export function changedFields(stored: Job, imported: JobCreate): Array<keyof JobSpec> {
  const before = normalise(jobToSpec(stored));
  const after = normalise(imported);

  return (Object.keys(before) as Array<keyof JobSpec>).filter(
    // without a start date, PUT keeps the job's own
    (field) =>
      !(field === 'start_date' && imported.start_date == null) && stable(before[field]) !== stable(after[field])
  );
}

export type ImportStatus = 'new' | 'changed' | 'unchanged' | 'invalid';

export interface ImportItem {
  definition: JobCreate;
  status: ImportStatus;
  /** changed: the fields that differ */
  changes: string[];
  /** invalid: why */
  error?: string;
  /** what would fail, or surprise, once imported */
  warnings: string[];
}

/**
 * A file's definitions against the stored jobs. validate is the backend's
 * /preview: it resolves to the swarm objects the job would miss, and rejects
 * with why the definition is invalid.
 */
export async function planImport(
  definitions: JobCreate[],
  stored: Job[],
  validate: (definition: JobCreate) => Promise<string[]>,
  now: Date = new Date()
): Promise<ImportItem[]> {
  const counts = new Map<string, number>();
  definitions.forEach(({ name }) => counts.set(name, (counts.get(name) ?? 0) + 1));

  return Promise.all(
    definitions.map(async (definition): Promise<ImportItem> => {
      const invalid = (error: string): ImportItem => ({
        definition,
        status: 'invalid',
        changes: [],
        error,
        warnings: [],
      });

      const times = counts.get(definition.name) ?? 0;
      if (times > 1) {
        return invalid(`${definition.name} is in the file ${times} times`);
      }
      let problems: string[];
      try {
        problems = await validate(definition);
      } catch (err) {
        return invalid(errorMessage(err));
      }

      const existing = stored.find((job) => job.name === definition.name);
      if (existing) {
        const changes = changedFields(existing, definition);
        return { definition, status: changes.length ? 'changed' : 'unchanged', changes, warnings: problems };
      }

      const warnings = [...problems];
      const start = definition.start_date ? new Date(definition.start_date) : undefined;
      if (definition.catchup && start && start < now) {
        warnings.push(`catches up every interval since ${formatDate(definition.start_date)}`);
      }
      return { definition, status: 'new', changes: [], warnings };
    })
  );
}

/** The text of a file the browser gave. */
export function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Have the browser save text as a file. */
export function download(fileName: string, text: string, type = 'application/yaml'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** A spec the way the backend stores it: defaults filled in, instants in UTC, cron single-spaced. */
function normalise(spec: JobSpec): Record<keyof JobSpec, unknown> {
  const instant = (value: string | null) => {
    const date = value ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : value;
  };
  // a file may leave out what the backend fills in
  const completed = <T>(items: T[] | undefined, defaults: Partial<T>) =>
    (items ?? []).map((item) => ({ ...defaults, ...item }));
  return {
    ...spec,
    schedule: typeof spec.schedule === 'string' ? spec.schedule.split(/\s+/).filter(Boolean).join(' ') : spec.schedule,
    start_date: instant(spec.start_date),
    end_date: instant(spec.end_date),
    secrets: completed(spec.secrets, { target: '', uid: '10001', gid: '10001', mode: 0o400 }),
    configs: completed(spec.configs, { uid: '10001', gid: '10001', mode: 0o444 }),
    mounts: completed(spec.mounts, { type: 'volume', source: '', read_only: false }),
  };
}

/** JSON with object keys sorted: equal values, equal strings. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner
  );
}
