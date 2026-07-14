import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractStorageMaintenanceArtifacts,
  type MaintenanceArtifacts,
  validateStorageMaintenanceContract,
} from '../helpers/storage-maintenance-contract';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

function section(source: string, start: string, end?: string) {
  const startIndex = source.indexOf(start);
  expect(startIndex, `missing section ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
}

function maintenanceArtifacts(): MaintenanceArtifacts {
  return extractStorageMaintenanceArtifacts(
    read('docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md'),
  );
}

function replaceRequired(source: string, current: string, replacement: string) {
  expect(source).toContain(current);
  return source.replace(current, replacement);
}

function expectRejected(artifacts: MaintenanceArtifacts, issue: RegExp): void {
  expect(validateStorageMaintenanceContract(artifacts)).toEqual(
    expect.arrayContaining([expect.stringMatching(issue)]),
  );
}

describe('queued storage deletion deployment contract', () => {
  describe('maintenance artifact validator', () => {
    it('accepts the real 7.10 Bash and systemd artifacts', () => {
      expect(
        validateStorageMaintenanceContract(maintenanceArtifacts()),
      ).toEqual([]);
    });

    it('rejects removal of curl non-2xx handling', () => {
      const artifacts = maintenanceArtifacts();
      artifacts.script = replaceRequired(
        artifacts.script,
        '--fail-with-body',
        '',
      );
      expectRejected(artifacts, /fail-with-body/);
    });

    it.each(['--connect-timeout 5', '--max-time 20'])(
      'rejects removal of curl timeout flag %s',
      (flag) => {
        const artifacts = maintenanceArtifacts();
        artifacts.script = replaceRequired(artifacts.script, flag, '');
        expectRejected(artifacts, new RegExp(flag.split(' ')[0].slice(2)));
      },
    );

    it.each(['--retry 2', '--retry-delay 2', '--retry-all-errors'])(
      'rejects removal of curl retry flag %s',
      (flag) => {
        const artifacts = maintenanceArtifacts();
        artifacts.script = replaceRequired(artifacts.script, flag, '');
        expectRejected(artifacts, new RegExp(flag.split(' ')[0].slice(2)));
      },
    );

    it('rejects bypassing run_endpoint for either endpoint', () => {
      const artifacts = maintenanceArtifacts();
      artifacts.script = replaceRequired(
        artifacts.script,
        'if ! run_endpoint "queued object deletions"',
        'if ! unvalidated_endpoint "queued object deletions"',
      );
      expectRejected(artifacts, /both endpoints.*run_endpoint/i);
    });

    it('rejects jq parsing without exit-status semantics', () => {
      const artifacts = maintenanceArtifacts();
      artifacts.script = replaceRequired(
        artifacts.script,
        'jq -cer "$filter"',
        'jq -cr "$filter"',
      );
      expectRejected(artifacts, /jq.*exit status/i);
    });

    it('rejects returning success after JSON or field parsing fails', () => {
      const artifacts = maintenanceArtifacts();
      artifacts.script = replaceRequired(
        artifacts.script,
        'printf \'%s returned invalid JSON\\n\' "$name" >&2\n    return 1',
        'printf \'%s returned invalid JSON\\n\' "$name" >&2\n    return 0',
      );
      expectRejected(artifacts, /parse.*nonzero/i);
    });

    it('rejects removal of strict response field validation', () => {
      const artifacts = maintenanceArtifacts();
      artifacts.script = replaceRequired(
        artifacts.script,
        'pending: (.pending | nonnegint)',
        'pending: .pending',
      );
      expectRejected(artifacts, /field validation.*pending/i);
    });

    it.each([
      ['removes the failure assignment', 'status=1', ''],
      ['weakens the failed predicate', '.failed == 0', '.failed >= 0'],
    ])('rejects upload failed control flow that %s', (_name, current, next) => {
      const artifacts = maintenanceArtifacts();
      const uploadCheck = artifacts.script.match(
        /if \[\[ -n "\$upload_json" \]\][\s\S]*?\nfi/,
      )?.[0];
      expect(uploadCheck).toBeDefined();
      artifacts.script = replaceRequired(
        artifacts.script,
        uploadCheck!,
        replaceRequired(uploadCheck!, current, next),
      );
      expectRejected(artifacts, /upload.*failed.*service failure/i);
    });

    it.each([
      ['retried alert', '.retried > 0', '.retried < 0', /retried/],
      ['deferred alert', '.deferred > 0', '.deferred < 0', /deferred/],
      [
        'one-hour backlog alert',
        '>= 3600',
        '>= 7200',
        /pending.*oldestPendingAgeSeconds.*3600/,
      ],
    ])('rejects a weakened storage %s', (_name, current, next, issue) => {
      const artifacts = maintenanceArtifacts();
      artifacts.script = replaceRequired(artifacts.script, current, next);
      expectRejected(artifacts, issue);
    });

    it.each([
      ['below the two-endpoint retry budget', 127],
      ['without the required 30-second margin', 157],
    ])('rejects TimeoutStartSec %s', (_name, timeout) => {
      const artifacts = maintenanceArtifacts();
      artifacts.service = replaceRequired(
        artifacts.service,
        'TimeoutStartSec=180',
        `TimeoutStartSec=${timeout}`,
      );
      expectRejected(artifacts, /TimeoutStartSec.*158/);
    });
  });

  it('documents one 15-minute maintenance schedule for both authenticated endpoints', () => {
    const documents = [
      ['docs/operations.md', '## Scheduled jobs'],
      ['docs/storage.md', '## Scheduled storage maintenance'],
      ['docs/deployment.md', '## Scheduled maintenance'],
    ] as const;
    for (const [path, heading] of documents) {
      const scheduled = section(read(path), heading, '\n## ');
      expect(scheduled, path).toContain('/api/internal/uploads/cleanup');
      expect(scheduled, path).toContain('/api/internal/storage-deletions');
      expect(scheduled, path).toContain('UPLOAD_CLEANUP_SECRET');
      expect(scheduled, path).toMatch(/every\s+15 minutes/i);
      expect(scheduled, path).toContain('retried');
      expect(scheduled, path).toContain('deferred');
      expect(scheduled, path).toContain('pending');
      expect(scheduled, path).toContain('oldestPendingAgeSeconds');
      expect(scheduled, path).toMatch(/1 hour|3,?600 seconds/i);
    }
  });

  it('attempts both endpoints independently before returning failure', () => {
    const source = maintenanceArtifacts().script;
    expect(source).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+/);
    expect(source).not.toMatch(/printf[^\n]*UPLOAD_CLEANUP_SECRET/);
    expect(source).toMatch(/status=0/);
    expect(source).toMatch(/if ! response="\$\(curl[\s\S]*safe_json/);

    const uploadCall = source.search(
      /if ! run_endpoint[^\n]*\/api\/internal\/uploads\/cleanup/,
    );
    const deletionCall = source.search(
      /if ! run_endpoint[^\n]*\/api\/internal\/storage-deletions/,
    );
    expect(uploadCall).toBeGreaterThanOrEqual(0);
    expect(deletionCall).toBeGreaterThan(uploadCall);
    expect(source.slice(uploadCall, deletionCall)).toMatch(/status=1[\s\S]*fi/);
    expect(source.slice(uploadCall, deletionCall)).not.toMatch(/\n\s*exit\b/);
    expect(source.slice(deletionCall)).toMatch(/status=1[\s\S]*fi/);
    expect(source.trimEnd()).toMatch(/exit "\$status"$/);
    expect(source).toMatch(/Authorization: Bearer \$\{UPLOAD_CLEANUP_SECRET\}/);
    expect(source).toMatch(/jq -[a-z]*e[a-z]*[\s\S]*safe_json/);
    expect(source).toMatch(/\.retried > 0[\s\S]*status=1/);
    expect(source).toMatch(/\.deferred > 0/);
    expect(source).toMatch(
      /\.pending > 0[\s\S]*oldestPendingAgeSeconds[\s\S]*>= 3600[\s\S]*status=1/,
    );
  });

  it('binds the flocked oneshot to the timer and maintenance lifecycle', () => {
    const guide = read('docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md');
    const { service, timer } = maintenanceArtifacts();
    expect(service).toMatch(/Description=.*uploads.*queued object deletions/i);
    expect(service).toMatch(
      /ExecStart=\/usr\/bin\/flock --nonblock \S+ \S*\/campuslink-upload-cleanup/,
    );
    expect(service).toContain('TimeoutStartSec=180');
    expect(timer).toContain('OnUnitActiveSec=15min');
    expect(timer).toContain('Unit=campuslink-upload-cleanup.service');
    expect(timer).toMatch(/Description=.*uploads.*queued object deletions/i);

    const release = section(guide, '### 9.1', '\n### 9.2');
    expect(release).toContain('stop campuslink-upload-cleanup.timer');
    expect(release).toContain('start campuslink-upload-cleanup.timer');
    expect(release).toMatch(/上传清理与排队对象删除/);

    const checklist = section(guide, '## 11.', '\n## 12.');
    expect(checklist).toMatch(/上传清理与排队对象删除.*timer/);
    expect(checklist).toContain('retried');
    expect(checklist).toContain('deferred');
    expect(checklist).toContain('oldestPendingAgeSeconds');
    expect(checklist).toMatch(/1 小时|3600 秒/);
  });
});
