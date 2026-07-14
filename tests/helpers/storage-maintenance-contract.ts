export type MaintenanceArtifacts = {
  script: string;
  service: string;
  timer: string;
};

const ENDPOINT_PATHS = [
  '/api/internal/uploads/cleanup',
  '/api/internal/storage-deletions',
] as const;
const TIMEOUT_MARGIN_SECONDS = 30;

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`missing section ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`missing section end ${end}`);
  return source.slice(startIndex, endIndex);
}

function codeBlocks(source: string, language: string): string[] {
  const blocks: string[] = [];
  const fence = /^```([^\r\n]*)\r?\n([\s\S]*?)^```\s*$/gm;
  for (const match of source.matchAll(fence)) {
    if (match[1].trim() === language) blocks.push(match[2]);
  }
  return blocks;
}

export function extractStorageMaintenanceArtifacts(
  guide: string,
): MaintenanceArtifacts {
  const maintenance = section(guide, '### 7.10', '\n## 8.');
  const script = codeBlocks(maintenance, 'bash').find((block) =>
    block.includes('#!/usr/bin/env bash'),
  );
  const ini = codeBlocks(maintenance, 'ini');
  const service = ini.find((block) => block.includes('[Service]'));
  const timer = ini.find((block) => block.includes('[Timer]'));
  if (!script || !service || !timer) {
    throw new Error(
      '7.10 must contain maintenance Bash, service, and timer blocks',
    );
  }
  return { script, service, timer };
}

function shellFunction(source: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(
    new RegExp(`^${escapedName}\\(\\)\\s*\\{\\r?\\n([\\s\\S]*?)^\\}\\s*$`, 'm'),
  )?.[1];
}

function shellAssignment(source: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(
    new RegExp(`^${escapedName}='([\\s\\S]*?)'\\s*$`, 'm'),
  )?.[1];
}

function numericFlag(source: string, name: string): number | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = source.match(
    new RegExp(`--${escapedName}(?:=|\\s+)(\\d+(?:\\.\\d+)?)(?=\\s|\\\\|$)`),
  )?.[1];
  return value === undefined ? undefined : Number(value);
}

function hasFlag(source: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`--${escapedName}(?=\\s|=|\\\\|$)`).test(source);
}

function jqUsesExitStatus(argumentsSource: string): boolean {
  return /(?:^|\s)-[A-Za-z]*e[A-Za-z]*(?=\s|$)|(?:^|\s)--exit-status(?=\s|$)/.test(
    argumentsSource,
  );
}

function returnsNonzero(source: string): boolean {
  return /\breturn\s+[1-9]\d*\b/.test(source);
}

function setsFailure(source: string): boolean {
  return /(?:^|\n)\s*status\s*=\s*[1-9]\d*\s*(?:\n|$)/.test(source);
}

function systemdSeconds(value: string): number | undefined {
  const parsed = value.match(/^(\d+(?:\.\d+)?)(ms|s|sec|m|min|h)?$/);
  if (!parsed) return undefined;
  const multiplier =
    parsed[2] === 'ms'
      ? 0.001
      : parsed[2] === 'm' || parsed[2] === 'min'
        ? 60
        : parsed[2] === 'h'
          ? 3600
          : 1;
  return Number(parsed[1]) * multiplier;
}

function validatesField(filter: string | undefined, field: string): boolean {
  if (!filter) return false;
  if (field === 'oldestPendingAgeSeconds') {
    return /oldestPendingAgeSeconds:\s*\r?\n?\s*\(\.oldestPendingAgeSeconds[\s\S]*?nonnegint\s+end\)/.test(
      filter,
    );
  }
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `${escapedField}:\\s*\\([^\\r\\n]*\\|\\s*nonnegint\\)`,
  ).test(filter);
}

function jqAlert(
  source: string,
  predicate: RegExp,
): { argumentsSource: string; body: string } | undefined {
  const escapedPredicate = predicate.source;
  const match = source.match(
    new RegExp(
      `if\\s+jq\\s+([^\\r\\n]*'${escapedPredicate}'[^\\r\\n]*)\\s*;\\s*then\\s*\\r?\\n([\\s\\S]*?)^\\s*fi\\s*$`,
      'm',
    ),
  );
  return match ? { argumentsSource: match[1], body: match[2] } : undefined;
}

export function validateStorageMaintenanceContract(
  artifacts: MaintenanceArtifacts,
): string[] {
  const issues: string[] = [];
  const { script, service } = artifacts;
  const runEndpoint = shellFunction(script, 'run_endpoint');

  if (!runEndpoint) {
    issues.push('missing run_endpoint function');
    return issues;
  }

  const curlGuard = runEndpoint.match(
    /if\s+!\s+response="\$\(curl([\s\S]*?)\)"\s*;\s*then\s*\r?\n([\s\S]*?)^\s*fi\s*$/m,
  );
  const curlArguments = curlGuard?.[1] ?? '';
  if (!curlGuard || !curlArguments.includes('"$url"')) {
    issues.push('run_endpoint must guard the shared curl request');
  }
  if (!returnsNonzero(curlGuard?.[2] ?? '')) {
    issues.push('curl failure must return nonzero');
  }

  for (const path of ENDPOINT_PATHS) {
    const endpointCall = new RegExp(
      `^\\s*if\\s+!\\s+run_endpoint\\s+[^\\r\\n]*${path.replaceAll('/', '\\/')}[^\\r\\n]*;\\s*then\\s*$`,
      'm',
    );
    if (!endpointCall.test(script)) {
      issues.push('both endpoints must use run_endpoint');
      break;
    }
  }

  if (!hasFlag(curlArguments, 'fail-with-body')) {
    issues.push('run_endpoint curl must set --fail-with-body');
  }
  const connectTimeout = numericFlag(curlArguments, 'connect-timeout');
  if (connectTimeout === undefined || connectTimeout <= 0) {
    issues.push('run_endpoint curl must set a positive --connect-timeout');
  }
  const maxTime = numericFlag(curlArguments, 'max-time');
  if (maxTime === undefined || maxTime <= 0) {
    issues.push('run_endpoint curl must set a positive --max-time');
  }
  const retry = numericFlag(curlArguments, 'retry');
  if (retry === undefined || !Number.isInteger(retry) || retry < 1) {
    issues.push('run_endpoint curl must set a positive integer --retry');
  }
  const retryDelay = numericFlag(curlArguments, 'retry-delay');
  if (retryDelay === undefined || retryDelay < 0) {
    issues.push('run_endpoint curl must set --retry-delay');
  }
  if (!hasFlag(curlArguments, 'retry-all-errors')) {
    issues.push('run_endpoint curl must set --retry-all-errors');
  }

  const parseGuard = runEndpoint.match(
    /if\s+!\s+safe_json="\$\(jq\s+([^\r\n]+)\)"\s*;\s*then\s*\r?\n([\s\S]*?)^\s*fi\s*$/m,
  );
  if (!parseGuard || !jqUsesExitStatus(parseGuard[1])) {
    issues.push('run_endpoint jq parser must use exit status (-e)');
  }
  if (
    !parseGuard?.[1].includes('"$filter"') ||
    !parseGuard[1].includes('<<<"$response"') ||
    !returnsNonzero(parseGuard[2])
  ) {
    issues.push('response parse failure must return nonzero');
  }

  const uploadFilter = shellAssignment(script, 'upload_filter');
  for (const field of ['deletedPending', 'failed', 'retainedRejected']) {
    if (!validatesField(uploadFilter, field)) {
      issues.push(`response field validation missing for ${field}`);
    }
  }
  const deletionFilter = shellAssignment(script, 'deletion_filter');
  for (const field of [
    'deferred',
    'deleted',
    'missing',
    'retried',
    'pending',
    'oldestPendingAgeSeconds',
  ]) {
    if (!validatesField(deletionFilter, field)) {
      issues.push(`response field validation missing for ${field}`);
    }
  }

  const uploadFailure = script.match(
    /if\s+\[\[\s+-n\s+"\$upload_json"\s+\]\]\s+&&\s+!\s+jq\s+([^\r\n]*'\.failed\s*==\s*0'[^\r\n]*)\s*;\s*then\s*\r?\n([\s\S]*?)^\s*fi\s*$/m,
  );
  if (
    !uploadFailure ||
    !jqUsesExitStatus(uploadFailure[1]) ||
    !setsFailure(uploadFailure[2])
  ) {
    issues.push('upload .failed must cause service failure');
  }

  const deletionChecks = script.match(
    /if\s+\[\[\s+-n\s+"\$deletion_json"\s+\]\]\s*;\s*then\s*\r?\n([\s\S]*?)^fi\s*\r?\nexit\s+"\$status"/m,
  )?.[1];
  const retriedAlert = deletionChecks
    ? jqAlert(deletionChecks, /\.retried\s*>\s*0/)
    : undefined;
  if (
    !retriedAlert ||
    !jqUsesExitStatus(retriedAlert.argumentsSource) ||
    !/\bprintf\b/.test(retriedAlert.body) ||
    !setsFailure(retriedAlert.body)
  ) {
    issues.push('retried must alert and cause service failure');
  }
  const deferredAlert = deletionChecks
    ? jqAlert(deletionChecks, /\.deferred\s*>\s*0/)
    : undefined;
  if (
    !deferredAlert ||
    !jqUsesExitStatus(deferredAlert.argumentsSource) ||
    !/\bprintf\b/.test(deferredAlert.body)
  ) {
    issues.push('deferred must alert');
  }
  const pendingAlert = deletionChecks
    ? jqAlert(
        deletionChecks,
        /\.pending\s*>\s*0\s+and\s+\(\.oldestPendingAgeSeconds\s*\/\/\s*0\)\s*>=\s*3600/,
      )
    : undefined;
  if (
    !pendingAlert ||
    !jqUsesExitStatus(pendingAlert.argumentsSource) ||
    !/\bprintf\b/.test(pendingAlert.body) ||
    !setsFailure(pendingAlert.body)
  ) {
    issues.push('pending oldestPendingAgeSeconds 3600 must alert and fail');
  }

  if (!/exit\s+"\$status"\s*$/.test(script)) {
    issues.push('maintenance script must exit with aggregate status');
  }

  if (
    maxTime !== undefined &&
    retry !== undefined &&
    retryDelay !== undefined
  ) {
    const endpointBudget = maxTime * (retry + 1) + retryDelay * retry;
    const retryBudget = ENDPOINT_PATHS.length * endpointBudget;
    const requiredTimeout = Math.ceil(retryBudget + TIMEOUT_MARGIN_SECONDS);
    const timeoutValue = service.match(/^TimeoutStartSec=(\S+)\s*$/m)?.[1];
    const timeout = timeoutValue ? systemdSeconds(timeoutValue) : undefined;
    if (timeout === undefined || timeout < requiredTimeout) {
      issues.push(
        `TimeoutStartSec must be at least ${requiredTimeout} seconds (retry budget ${retryBudget} + 30)`,
      );
    }
  }

  return issues;
}
