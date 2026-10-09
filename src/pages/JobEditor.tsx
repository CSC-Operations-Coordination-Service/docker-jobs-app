import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PluginPage } from '@grafana/runtime';
import {
  Alert,
  Button,
  Field,
  FieldSet,
  Input,
  LinkButton,
  LoadingPlaceholder,
  Stack,
  Switch,
  TagsInput,
  TextArea,
} from '@grafana/ui';

import {
  ConfigRef,
  JobCreate,
  MountSpec,
  Preview,
  SecretRef,
  createJob,
  errorMessage,
  getJob,
  previewJob,
  updateJob,
} from '../api';
import { KeyValueEditor } from '../components/editors/KeyValueEditor';
import { RowsEditor, RowField } from '../components/editors/RowsEditor';
import { StringListEditor } from '../components/editors/StringListEditor';
import { ROUTES, prefixRoute } from '../constants';
import { emptyJob, formatDate, formatInterval, jobToSpec } from '../utils';

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

const SECRET_FIELDS: Array<RowField<SecretRef>> = [
  { key: 'source', label: 'secret', placeholder: 'swarm secret name', width: 40 },
  { key: 'target', label: 'file', placeholder: '/run/secrets/<file>, the name if empty', width: 40 },
];
const CONFIG_FIELDS: Array<RowField<ConfigRef>> = [
  { key: 'source', label: 'config', placeholder: 'swarm config name', width: 40 },
  { key: 'target', label: 'path', placeholder: '/conf/collector/odata.json', width: 40 },
];
const MOUNT_FIELDS: Array<RowField<MountSpec>> = [
  { key: 'type', label: 'type', kind: 'choice', choices: ['volume', 'tmpfs', 'bind'] },
  { key: 'source', label: 'source', placeholder: 'volume name', width: 30 },
  { key: 'target', label: 'target', placeholder: '/work', width: 30 },
  { key: 'read_only', label: 'read only', kind: 'bool' },
];

const newSecret = (): SecretRef => ({ source: '', target: '', uid: '10001', gid: '10001', mode: 0o400 });
const newConfig = (): ConfigRef => ({ source: '', target: '', uid: '10001', gid: '10001', mode: 0o444 });
const newMount = (): MountSpec => ({ type: 'volume', source: '', target: '', read_only: false });

/** "" for nothing, the number otherwise: optional numeric fields. */
const optionalNumber = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/**
 * Create a job (/jobs/new) or change one (/jobs/:name/edit). Preview renders
 * the command for an interval and lists the swarm objects that would be
 * missing; Save sends the definition, and the backend's checks come back
 * as the error above the form, the form kept as typed.
 */
export function JobEditor() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<JobCreate | undefined>(name ? undefined : emptyJob());
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [previewDate, setPreviewDate] = useState('');

  useEffect(() => {
    if (!name) {
      return;
    }
    getJob(name)
      .then((job) => setForm({ ...jobToSpec(job), name: job.name }))
      .catch((err) => setError(errorMessage(err)));
  }, [name]);

  if (!form) {
    return (
      <PluginPage>
        {error ? <Alert title="Cannot load the job">{error}</Alert> : <LoadingPlaceholder text="Loading..." />}
      </PluginPage>
    );
  }

  const set = <K extends keyof JobCreate>(key: K, value: JobCreate[K]) => setForm({ ...form, [key]: value });
  const nameIsValid = NAME_PATTERN.test(form.name);
  const savable = nameIsValid && form.image.trim() !== '' && form.schedule.trim() !== '';

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      if (name) {
        const { name: _name, ...spec } = form;
        await updateJob(name, spec);
      } else {
        await createJob(form);
      }
      navigate(prefixRoute(ROUTES.Jobs));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setError(undefined);
    try {
      setPreview(await previewJob(form, previewDate.trim() || undefined));
    } catch (err) {
      setPreview(undefined);
      setError(errorMessage(err));
    }
  };

  return (
    <PluginPage>
      <Stack direction="column" gap={2}>
        {error && (
          <Alert severity="error" title={name ? `Cannot save ${name}` : 'Cannot save the job'}>
            {error}
          </Alert>
        )}

        <FieldSet label="Job">
          <Field
            label="Name"
            description="Lowercase letters, digits and inner dashes, 32 at most; it cannot change later"
            invalid={form.name !== '' && !nameIsValid}
            error="Not a valid job name"
          >
            <Input
              id="job-name"
              width={40}
              value={form.name}
              disabled={Boolean(name)}
              onChange={(event) => set('name', event.currentTarget.value)}
            />
          </Field>
          <Field label="Description">
            <TextArea
              id="job-description"
              rows={2}
              value={form.description}
              onChange={(event) => set('description', event.currentTarget.value)}
            />
          </Field>
          <Field label="Image" description="An immutable tag: each attempt pulls it when it starts">
            <Input
              id="job-image"
              value={form.image}
              placeholder="127.0.0.1:8085/maas-collector:3.10.1"
              onChange={(event) => set('image', event.currentTarget.value)}
            />
          </Field>
          <Field label="Enabled" description="A disabled job creates no runs and starts none">
            <Switch
              id="job-enabled"
              value={form.enabled}
              onChange={(event) => set('enabled', event.currentTarget.checked)}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Schedule">
          <Field
            label="Cron (UTC)"
            description="5 fields. The run for an interval starts when it ends: 0 * * * * at 01:00 covers 00:00 → 01:00"
          >
            <Input
              id="job-schedule"
              width={40}
              value={form.schedule}
              onChange={(event) => set('schedule', event.currentTarget.value)}
            />
          </Field>
          <Field label="Start date" description="ISO 8601 with a timezone; empty: the current interval">
            <Input
              id="job-start-date"
              width={40}
              placeholder="2026-10-09T00:00:00Z"
              value={form.start_date ?? ''}
              onChange={(event) => set('start_date', event.currentTarget.value.trim() || null)}
            />
          </Field>
          <Field label="End date" description="Optional: no interval ends after it">
            <Input
              id="job-end-date"
              width={40}
              value={form.end_date ?? ''}
              onChange={(event) => set('end_date', event.currentTarget.value.trim() || null)}
            />
          </Field>
          <Field label="Catch up" description="Run every missed interval after an outage; off: only the latest">
            <Switch
              id="job-catchup"
              value={form.catchup}
              onChange={(event) => set('catchup', event.currentTarget.checked)}
            />
          </Field>
          <Field label="Runs at once" description="1: never overlap">
            <Input
              id="job-max-active-runs"
              type="number"
              width={10}
              value={form.max_active_runs}
              onChange={(event) => set('max_active_runs', Number(event.currentTarget.value))}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Command">
          <Field
            label="Override the entrypoint"
            description="Off: the image's ENTRYPOINT. On: these arguments replace it"
          >
            <Switch
              id="job-entrypoint-override"
              value={form.entrypoint !== null}
              onChange={(event) => set('entrypoint', event.currentTarget.checked ? [] : null)}
            />
          </Field>
          {form.entrypoint !== null && (
            <StringListEditor
              label="entrypoint argument"
              value={form.entrypoint}
              onChange={(entrypoint) => set('entrypoint', entrypoint)}
              paste
            />
          )}
          <Field
            label="Command"
            description="One argument per row, no shell. Templates: {{ data_interval_start | iso_ms }}, {{ params.x }}, ..."
          >
            <StringListEditor
              label="argument"
              value={form.command}
              onChange={(command) => set('command', command)}
              paste
            />
          </Field>
          <Field label="Environment" description="Values are templates too">
            <KeyValueEditor label="variable" value={form.env} onChange={(env) => set('env', env)} />
          </Field>
          <Field label="Params" description="{{ params.<name> }} in the templates">
            <KeyValueEditor label="param" value={form.params} onChange={(params) => set('params', params)} />
          </Field>
        </FieldSet>

        <FieldSet label="Retries and limits">
          <Field label="Retries" description="Tries after the first failure">
            <Input
              id="job-retries"
              type="number"
              width={10}
              value={form.retries}
              onChange={(event) => set('retries', Number(event.currentTarget.value))}
            />
          </Field>
          <Field label="Retry delay (s)">
            <Input
              id="job-retry-delay"
              type="number"
              width={10}
              value={form.retry_delay_seconds}
              onChange={(event) => set('retry_delay_seconds', Number(event.currentTarget.value))}
            />
          </Field>
          <Field label="Timeout (s)" description="An attempt still running after this is stopped">
            <Input
              id="job-timeout"
              type="number"
              width={10}
              value={form.timeout_seconds}
              onChange={(event) => set('timeout_seconds', Number(event.currentTarget.value))}
            />
          </Field>
          <Field label="CPU limit" description="CPUs, e.g. 0.5; empty: none">
            <Input
              id="job-cpu-limit"
              type="number"
              width={10}
              value={form.cpu_limit ?? ''}
              onChange={(event) => set('cpu_limit', optionalNumber(event.currentTarget.value))}
            />
          </Field>
          <Field label="Memory limit (MB)" description="Empty: none">
            <Input
              id="job-memory-limit"
              type="number"
              width={10}
              value={form.memory_limit_mb ?? ''}
              onChange={(event) => set('memory_limit_mb', optionalNumber(event.currentTarget.value))}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Swarm">
          <Field label="Networks" description="Overlay networks, by name: a stack's are <stack>_<network>">
            <TagsInput tags={form.networks} onChange={(networks) => set('networks', networks)} />
          </Field>
          <Field label="Placement constraints" description="e.g. node.labels.role == maas">
            <TagsInput tags={form.constraints} onChange={(constraints) => set('constraints', constraints)} />
          </Field>
          <Field label="Secrets" description="Mounted read-only for uid 10001">
            <RowsEditor
              label="secret"
              rows={form.secrets}
              fields={SECRET_FIELDS}
              empty={newSecret}
              onChange={(secrets) => set('secrets', secrets)}
            />
          </Field>
          <Field label="Configs">
            <RowsEditor
              label="config"
              rows={form.configs}
              fields={CONFIG_FIELDS}
              empty={newConfig}
              onChange={(configs) => set('configs', configs)}
            />
          </Field>
          <Field label="Mounts" description="Bind mounts only where the backend allows them">
            <RowsEditor
              label="mount"
              rows={form.mounts}
              fields={MOUNT_FIELDS}
              empty={newMount}
              onChange={(mounts) => set('mounts', mounts)}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Preview">
          <Stack gap={1} alignItems="center">
            <Input
              aria-label="Preview for the interval of"
              width={40}
              placeholder="a date in the interval; empty: the latest ended"
              value={previewDate}
              onChange={(event) => setPreviewDate(event.currentTarget.value)}
            />
            <Button variant="secondary" icon="eye" disabled={!savable} onClick={runPreview}>
              Preview
            </Button>
          </Stack>
          {preview && <PreviewResult preview={preview} />}
        </FieldSet>

        <Stack gap={1}>
          <Button disabled={!savable || saving} icon={saving ? 'spinner' : 'save'} onClick={save}>
            Save
          </Button>
          <LinkButton variant="secondary" href={prefixRoute(ROUTES.Jobs)}>
            Cancel
          </LinkButton>
        </Stack>
      </Stack>
    </PluginPage>
  );
}

function PreviewResult({ preview }: { preview: Preview }) {
  return (
    <Stack direction="column" gap={1}>
      {preview.problems.length > 0 && (
        <Alert severity="warning" title="A launch would fail">
          <ul>
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div>Interval: {formatInterval(preview.data_interval_start, preview.data_interval_end)}</div>
      {preview.entrypoint && <pre>entrypoint: {JSON.stringify(preview.entrypoint)}</pre>}
      <pre>command: {JSON.stringify(preview.command)}</pre>
      {Object.keys(preview.env).length > 0 && <pre>env: {JSON.stringify(preview.env, null, 1)}</pre>}
      <div>Next runs (UTC): {preview.next_fire_times.map(formatDate).join(', ')}</div>
    </Stack>
  );
}

export default JobEditor;
