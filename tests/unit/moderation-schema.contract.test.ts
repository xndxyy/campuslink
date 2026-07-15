import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function readSource(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const schema = readSource('../../prisma/schema.prisma');
const migration = readSource(
  '../../prisma/migrations/20260713210000_add_content_assessment/migration.sql',
);
const integrationSchemaSource = readSource(
  '../integration/schema-constraints.test.ts',
);

function block(kind: 'enum' | 'model', name: string) {
  return (
    schema.match(new RegExp(`${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ??
    ''
  );
}

describe('content assessment persistence schema contract', () => {
  it('bounds assessment targets, decisions, and provider execution states', () => {
    const targets = block('enum', 'ContentAssessmentTarget');
    for (const target of [
      'RESOURCE',
      'MARKETPLACE_ITEM',
      'CAMPUS_WORK',
      'FORUM_POST',
      'FORUM_COMMENT',
      'CUSTOM_TAG',
    ]) {
      expect(targets).toMatch(new RegExp(`\\b${target}\\b`));
    }

    expect(block('enum', 'ContentAssessmentDecision')).toMatch(
      /\bPASS\b[\s\S]*\bREVIEW\b[\s\S]*\bBLOCK\b/,
    );
    expect(block('enum', 'ProviderExecutionStatus')).toMatch(
      /\bCOMPLETED\b[\s\S]*\bSKIPPED\b/,
    );
  });

  it('stores campus-scoped plain-text blocked words with governance metadata', () => {
    const blockedWord = block('model', 'BlockedWord');

    expect(blockedWord).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(blockedWord).toMatch(/campusId\s+String/);
    expect(blockedWord).toMatch(/original\s+String\s+@db\.VarChar\(200\)/);
    expect(blockedWord).toMatch(/normalized\s+String\s+@db\.VarChar\(200\)/);
    expect(blockedWord).toMatch(/category\s+String\s+@db\.VarChar\(100\)/);
    expect(blockedWord).toMatch(/reason\s+String\s+@db\.VarChar\(1000\)/);
    expect(blockedWord).toMatch(/enabled\s+Boolean\s+@default\(true\)/);
    expect(blockedWord).toMatch(
      /campus\s+Campus\s+@relation\(fields: \[campusId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(blockedWord).toContain('@@unique([campusId, normalized])');
    expect(blockedWord).toContain('@@index([campusId, enabled, category])');
    expect(block('model', 'Campus')).toMatch(/blockedWords\s+BlockedWord\[\]/);
  });

  it('keeps exactly one encrypted AI configuration per campus', () => {
    const config = block('model', 'AiModerationConfig');

    expect(config).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(config).toMatch(/campusId\s+String\s+@unique/);
    expect(config).toMatch(/enabled\s+Boolean\s+@default\(false\)/);
    expect(config).toMatch(/baseUrl\s+String\s+@db\.VarChar\(500\)/);
    expect(config).toMatch(/model\s+String\s+@db\.VarChar\(200\)/);
    expect(config).toMatch(/encryptedApiKey\s+String\s+@db\.Text/);
    expect(config).toMatch(/apiKeyLastFour\s+String\s+@db\.VarChar\(4\)/);
    expect(config).toMatch(/encryptionVersion\s+Int/);
    expect(config).toMatch(/timeoutMs\s+Int\s+@default\(8000\)/);
    expect(config).toMatch(/reviewThreshold\s+Int\s+@default\(40\)/);
    expect(config).toMatch(/blockThreshold\s+Int\s+@default\(80\)/);
    expect(config).toMatch(
      /campus\s+Campus\s+@relation\(fields: \[campusId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(config).toContain('@@unique([id, campusId])');
    expect(config).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(config).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    expect(block('model', 'Campus')).toMatch(
      /aiModerationConfig\s+AiModerationConfig\?/,
    );
  });

  it('persists structured assessment output without provider bodies or plaintext keys', () => {
    const assessment = block('model', 'ContentAssessment');

    expect(assessment).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(assessment).toMatch(/campusId\s+String/);
    expect(assessment).toMatch(/configId\s+String\?/);
    expect(assessment).toMatch(/targetType\s+ContentAssessmentTarget/);
    expect(assessment).toMatch(/targetId\s+String\s+@db\.VarChar\(200\)/);
    expect(assessment).toMatch(/decision\s+ContentAssessmentDecision/);
    expect(assessment).toMatch(/providerStatus\s+ProviderExecutionStatus/);
    expect(assessment).toMatch(/riskScore\s+Int\?/);
    expect(assessment).toMatch(/categories\s+String\[\]\s+@default\(\[\]\)/);
    expect(assessment).toMatch(/reasonZh\s+String\?\s+@db\.Text/);
    expect(assessment).toMatch(/suggestionZh\s+String\?\s+@db\.Text/);
    expect(assessment).toMatch(/adminSignals\s+Json\?/);
    expect(assessment).toMatch(/model\s+String\?\s+@db\.VarChar\(200\)/);
    expect(assessment).toMatch(
      /campus\s+Campus\s+@relation\(fields: \[campusId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(assessment).toMatch(
      /config\s+AiModerationConfig\?\s+@relation\(fields: \[configId, campusId\], references: \[id, campusId\], onDelete: Restrict\)/,
    );
    expect(assessment).toContain(
      '@@index([campusId, decision, createdAt, id])',
    );
    expect(assessment).toContain(
      '@@index([campusId, providerStatus, createdAt, id])',
    );
    expect(assessment).toContain(
      '@@index([targetType, targetId, createdAt, id])',
    );
    expect(assessment).not.toMatch(/providerRaw|rawBody|plaintextApiKey/i);
    expect(block('model', 'Campus')).toMatch(
      /contentAssessments\s+ContentAssessment\[\]/,
    );
  });

  it('enforces bounded configuration and assessment values in SQL', () => {
    expect(migration).toMatch(
      /CHECK \(0 <= "reviewThreshold" AND "reviewThreshold" < "blockThreshold" AND "blockThreshold" <= 100\)/,
    );
    expect(migration).toMatch(
      /CHECK \("timeoutMs" >= 1000 AND "timeoutMs" <= 60000\)/,
    );
    expect(migration).toMatch(/CHECK \("encryptionVersion" > 0\)/);
    expect(migration).toMatch(/CHECK \(char_length\("apiKeyLastFour"\) = 4\)/);
    expect(migration).toMatch(
      /CHECK \("riskScore" IS NULL OR \("riskScore" >= 0 AND "riskScore" <= 100\)\)/,
    );
    expect(migration).toMatch(
      /CHECK \(char_length\(btrim\("normalized"\)\) > 0\)/,
    );
    expect(migration).toMatch(
      /CHECK \(char_length\(btrim\("targetId"\)\) > 0\)/,
    );
    expect(migration).toContain('BlockedWord_campusId_normalized_key');
    expect(migration).toContain(
      'ContentAssessment_campusId_decision_createdAt_id_idx',
    );
    expect(migration).toContain(
      'ContentAssessment_campusId_providerStatus_createdAt_id_idx',
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "AiModerationConfig_id_campusId_key"\s+ON "AiModerationConfig"\("id", "campusId"\);/,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "ContentAssessment_configId_campusId_fkey"\s+FOREIGN KEY \("configId", "campusId"\) REFERENCES "AiModerationConfig"\("id", "campusId"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE;/,
    );
    expect(migration).not.toMatch(
      /ADD CONSTRAINT "ContentAssessment_configId_fkey"/,
    );
  });

  it('proves threshold rejection through direct PostgreSQL integration', () => {
    expect(integrationSchemaSource).toContain(
      "it('rejects invalid AI moderation thresholds at the database boundary'",
    );
    expect(integrationSchemaSource).toContain(
      'INSERT INTO "AiModerationConfig"',
    );
    expect(integrationSchemaSource).toContain("code: '23514'");
  });

  it('proves assessment configuration campus ownership through direct PostgreSQL integration', () => {
    expect(integrationSchemaSource).toContain(
      "it('rejects cross-campus assessment configuration references at the database boundary'",
    );
    expect(integrationSchemaSource).toContain(
      "constraint: 'ContentAssessment_configId_campusId_fkey'",
    );
    expect(integrationSchemaSource).toContain("code: '23503'");
  });

  it('keeps the content assessment migration expand-only and atomic', () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
    expect(migration).not.toMatch(
      /\bDROP\s+(?:TABLE|TYPE|COLUMN|CONSTRAINT|INDEX)\b/i,
    );
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b/i);
  });
});
