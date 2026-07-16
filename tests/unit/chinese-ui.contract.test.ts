import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

function filesUnder(directory: string, extension: string) {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path, extension));
    else if (extname(entry.name) === extension) result.push(path);
  }
  return result;
}

const allowedEnglish = [
  'API Key',
  'CampusLink',
  'OpenAI',
  'API',
  'URL',
  'ID',
  'AI',
] as const;

function withoutAllowedEnglish(value: string) {
  return allowedEnglish.reduce(
    (current, allowed) => current.replaceAll(allowed, ''),
    value,
  );
}

function visibleEnglish(path: string) {
  const source = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const failures: string[] = [];
  const inspect = (value: string, line: number) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]{2,}/.test(withoutAllowedEnglish(normalized))) {
      failures.push(`${relative(root, path)}:${line}:${normalized}`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      inspect(node.text, file.getLineAndCharacterOfPosition(node.pos).line + 1);
    }
    if (
      ts.isJsxAttribute(node) &&
      ['aria-label', 'placeholder', 'title'].includes(
        node.name.getText(file),
      ) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      inspect(
        node.initializer.text,
        file.getLineAndCharacterOfPosition(node.pos).line + 1,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return failures;
}

describe('Chinese user-facing copy', () => {
  it('allows only explicit product and technical terms in visible JSX text', () => {
    const failures = [
      ...filesUnder(join(root, 'app'), '.tsx'),
      ...filesUnder(join(root, 'components'), '.tsx'),
    ].flatMap(visibleEnglish);

    expect(failures).toEqual([]);
  });

  it('removes known English client and API feedback', () => {
    const sources = [
      ...filesUnder(join(root, 'app'), '.ts'),
      ...filesUnder(join(root, 'components'), '.tsx'),
      join(root, 'lib/domain/admin-route.ts'),
      join(root, 'lib/domain/content-action-route.ts'),
      join(root, 'lib/domain/content-routes.ts'),
      join(root, 'lib/domain/engagement-routes.ts'),
    ];
    const prohibited = [
      'Invalid request origin.',
      'Authentication is required.',
      'A verified account is required.',
      'Invalid administration request.',
      'Unable to complete administration request.',
      'Invalid content action.',
      'Content was not found.',
      'Content state conflict.',
      'Unable to update content.',
      'Unable to create content.',
      'Upload is ready.',
      'Unable to start upload.',
      'Unable to complete upload.',
      'Latest moderator decision',
      'Submit report',
      'Sign in with a verified campus account',
      'Settings change failed.',
      'Report action failed.',
    ];
    const failures = sources.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return prohibited
        .filter((phrase) => source.includes(phrase))
        .map((phrase) => `${relative(root, path)}:${phrase}`);
    });

    expect(failures).toEqual([]);
  });
});
