import 'server-only';

import { promises as dns } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export class OutboundUrlRejectedError extends Error {
  constructor() {
    super('Outbound AI URL was rejected.');
    this.name = 'OutboundUrlRejectedError';
  }
}
export interface OutboundAiPolicy {
  allowedHosts: ReadonlySet<string>;
}
type Lookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Address = { address: string; family: number };
type FetcherFactory = (addresses: Address[]) => Fetcher;

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blockedV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
] as const)
  blockedV6.addSubnet(address, prefix, 'ipv6');

function publicAddress(address: string, family: number) {
  if (family === 4 && isIP(address) === 4)
    return !blockedV4.check(address, 'ipv4');
  if (family === 6 && isIP(address) === 6)
    return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
  return false;
}

async function resolveOutboundAiTarget(
  value: string,
  policy: OutboundAiPolicy,
  lookup: Lookup = (hostname, options) => dns.lookup(hostname, options),
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundUrlRejectedError();
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  const allowed = new Set(
    [...policy.allowedHosts]
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean),
  );
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    isIP(hostname) ||
    !allowed.has(hostname)
  )
    throw new OutboundUrlRejectedError();
  let addresses: Address[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new OutboundUrlRejectedError();
  }
  if (
    !addresses.length ||
    addresses.some(({ address, family }) => !publicAddress(address, family))
  )
    throw new OutboundUrlRejectedError();
  return { addresses, url };
}

export async function validateOutboundAiUrl(
  value: string,
  policy: OutboundAiPolicy,
  lookup?: Lookup,
) {
  return (await resolveOutboundAiTarget(value, policy, lookup)).url;
}

export function loadOutboundAiPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): OutboundAiPolicy {
  const values = environment.AI_ALLOWED_HOSTS?.split(',') ?? [];
  const allowedHosts = new Set(
    values
      .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean),
  );
  if (
    allowedHosts.size === 0 ||
    [...allowedHosts].some(
      (host) =>
        isIP(host) !== 0 ||
        host.length > 253 ||
        !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
          host,
        ),
    )
  ) {
    throw new OutboundUrlRejectedError();
  }
  return { allowedHosts };
}

export async function fetchWithValidatedAiRedirects(
  initialUrl: string | URL,
  policy: OutboundAiPolicy,
  init: RequestInit,
  dependencies: {
    fetcher?: Fetcher;
    fetcherFactory?: FetcherFactory;
    lookup?: Lookup;
  } = {},
) {
  const first = await resolveOutboundAiTarget(
    String(initialUrl),
    policy,
    dependencies.lookup,
  );
  let target = first;
  for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
    const fetcher =
      dependencies.fetcher ??
      (dependencies.fetcherFactory ?? pinnedFetcher)(target.addresses);
    const response = await fetcher(target.url, {
      ...init,
      redirect: 'manual',
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirectCount === 2) throw new OutboundUrlRejectedError();
    let next: URL;
    try {
      next = new URL(location, target.url);
    } catch {
      throw new OutboundUrlRejectedError();
    }
    const validated = await resolveOutboundAiTarget(
      next.toString(),
      policy,
      dependencies.lookup,
    );
    if (validated.url.origin !== first.url.origin)
      throw new OutboundUrlRejectedError();
    target = validated;
  }
  throw new OutboundUrlRejectedError();
}

const pinnedAgents = new Map<string, Agent>();

function pinnedFetcher(addresses: Address[]): Fetcher {
  const key = addresses
    .map(({ address, family }) => `${family}:${address}`)
    .sort()
    .join(',');
  let agent = pinnedAgents.get(key);
  if (!agent) {
    let cursor = 0;
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      const requestedFamily = Number(options.family ?? 0);
      const candidates = requestedFamily
        ? addresses.filter(({ family }) => family === requestedFamily)
        : addresses;
      if (candidates.length === 0) {
        const error = new Error(
          'No validated address for requested family',
        ) as NodeJS.ErrnoException;
        error.code = 'ENOTFOUND';
        callback(error, '', 0);
        return;
      }
      if (options.all) {
        callback(null, candidates);
        return;
      }
      const selected = candidates[cursor % candidates.length];
      cursor += 1;
      callback(null, selected.address, selected.family);
    };
    agent = new Agent({ connect: { lookup: pinnedLookup } });
    if (pinnedAgents.size >= 100) {
      for (const existing of pinnedAgents.values()) void existing.close();
      pinnedAgents.clear();
    }
    pinnedAgents.set(key, agent);
  }
  return (input, init) =>
    undiciFetch(input, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: agent,
    }) as unknown as Promise<Response>;
}
