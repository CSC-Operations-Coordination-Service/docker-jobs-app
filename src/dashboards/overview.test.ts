import dashboard from './overview.json';

// docker-jobs-backend's metrics (src/docker_jobs_backend/telemetry.py there),
// as Mimir stores them: with otel_metric_suffixes_enabled a counter gets
// _total and a seconds unit _seconds; without, neither.
const COUNTERS = ['runs_created', 'runs_finished', 'attempts_started', 'attempts_finished', 'intervals_skipped'];
const GAUGES = ['job_gaps', 'runs_active', 'docker_up'];
const SECONDS_GAUGES = ['job_covered_until', 'scheduler_heartbeat'];
const SECONDS_HISTOGRAMS = ['attempt_duration'];

function names(suffixes: boolean): string[] {
  const seconds = suffixes ? '_seconds' : '';
  return [
    ...COUNTERS.map((name) => `docker_jobs_${name}${suffixes ? '_total' : ''}`),
    ...GAUGES.map((name) => `docker_jobs_${name}`),
    ...SECONDS_GAUGES.map((name) => `docker_jobs_${name}${seconds}`),
    ...SECONDS_HISTOGRAMS.flatMap((name) =>
      ['bucket', 'sum', 'count'].map((part) => `docker_jobs_${name}${seconds}_${part}`)
    ),
  ];
}

type Panel = { type: string; title: string; datasource?: { uid: string }; targets?: Array<{ expr: string }> };

const panels = dashboard.panels as Panel[];
const queried = panels.filter((panel) => panel.type !== 'row');

describe('the overview dashboard', () => {
  it.each([true, false])('finds every metric it queries, Mimir suffixes %s', (suffixes) => {
    const known = names(suffixes);

    for (const panel of queried) {
      for (const { expr } of panel.targets ?? []) {
        const regexes = Array.from(expr.matchAll(/__name__=~"([^"]+)"/g), (match) => new RegExp(`^${match[1]}$`));
        const plain = expr.replace(/__name__=~"[^"]+"/g, '').match(/docker_jobs_[a-z_]+/g) ?? [];

        for (const regex of regexes) {
          expect(known.some((name) => regex.test(name))).toBe(true);
        }
        for (const name of plain) {
          expect(known).toContain(name);
        }
        expect(regexes.length + plain.length).toBeGreaterThan(0);
      }
    }
  });

  it('queries the datasource picked in its variable, every panel', () => {
    for (const panel of queried) {
      expect(panel.datasource?.uid).toBe('${datasource}');
    }
  });

  it('keeps a stable uid, so a new version replaces the old one', () => {
    expect(dashboard.uid).toBe('ocs-dockerjobs-overview');
  });
});
