import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const blockedNames = new Set(['localhost', 'metadata.google.internal', 'metadata.google', 'instance-data.ec2.internal']);
function isPublicAddress(address: string): boolean {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs are allowed');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (blockedNames.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Local and metadata hosts are blocked');
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Private and reserved IP addresses are blocked');
  } else {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    if (!answers.length || answers.some((answer) => !isPublicAddress(answer.address))) throw new Error('Host resolves to a private or reserved IP address');
  }
  return url;
}

export async function validateRedirectChain(input: string, maxRedirects = 5): Promise<void> {
  let target = input;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const url = await assertPublicHttpUrl(target);
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (response.status < 300 || response.status >= 400) return;
    const location = response.headers.get('location');
    if (!location || redirects === maxRedirects) throw new Error('Too many or invalid redirects');
    target = new URL(location, url).toString();
  }
}
