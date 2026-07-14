import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

function section(source: string, start: string, end?: string) {
  const startIndex = source.indexOf(start);
  expect(startIndex, `missing section ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
}

function codeBlocks(source: string, language: string) {
  const marker = `\`\`\`${language}\n`;
  const blocks: string[] = [];
  let offset = 0;
  while (true) {
    const start = source.indexOf(marker, offset);
    if (start < 0) return blocks;
    const bodyStart = start + marker.length;
    const end = source.indexOf('\n```', bodyStart);
    if (end < 0) return blocks;
    blocks.push(source.slice(bodyStart, end));
    offset = end + 4;
  }
}

describe('queued storage deletion deployment contract', () => {
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
    const guide = read('docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md');
    const maintenance = section(guide, '### 7.10', '\n## 8.');
    const script = codeBlocks(maintenance, 'bash').find((block) =>
      block.includes('#!/usr/bin/env bash'),
    );
    expect(script).toBeDefined();
    const source = script!;
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
    const maintenance = section(guide, '### 7.10', '\n## 8.');
    const ini = codeBlocks(maintenance, 'ini');
    const service = ini.find((block) => block.includes('[Service]')) ?? '';
    const timer = ini.find((block) => block.includes('[Timer]')) ?? '';
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
