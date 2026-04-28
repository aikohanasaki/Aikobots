import dns from 'node:dns/promises';

import fetch from 'node-fetch';
import ipaddr from 'ipaddr.js';

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const INTERNAL_HOSTNAMES = new Set([
    'localhost',
    'metadata',
    'metadata.google.internal',
    'instance-data',
    'instance-data.ec2.internal',
]);

export class UrlSecurityError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'UrlSecurityError';
        this.statusCode = statusCode;
    }
}

function normalizeHostname(hostname) {
    return String(hostname || '')
        .trim()
        .toLowerCase()
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .replace(/\.$/, '');
}

function parseIpAddress(address) {
    const normalizedAddress = normalizeHostname(address);
    if (!ipaddr.isValid(normalizedAddress)) {
        return null;
    }

    let parsedAddress = ipaddr.parse(normalizedAddress);
    if (parsedAddress.kind() === 'ipv6' && typeof parsedAddress.isIPv4MappedAddress === 'function' && parsedAddress.isIPv4MappedAddress()) {
        parsedAddress = parsedAddress.toIPv4Address();
    }
    return parsedAddress;
}

function isPublicIpAddress(address) {
    const parsedAddress = parseIpAddress(address);
    return Boolean(parsedAddress && parsedAddress.range() === 'unicast');
}

function isInternalHostname(hostname) {
    const normalizedHostname = normalizeHostname(hostname);
    return INTERNAL_HOSTNAMES.has(normalizedHostname)
        || normalizedHostname.endsWith('.localhost')
        || normalizedHostname.endsWith('.local')
        || normalizedHostname.endsWith('.internal')
        || normalizedHostname.endsWith('.lan');
}

async function assertPublicDnsResolution(hostname) {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    const addresses = results.map(result => result.address).filter(Boolean);

    if (!addresses.length) {
        throw new UrlSecurityError(`Unable to resolve host: ${hostname}`, 502);
    }

    if (addresses.some(address => !isPublicIpAddress(address))) {
        throw new UrlSecurityError(`Host resolves to a non-public address: ${hostname}`);
    }
}

export function getUrlHostname(url) {
    try {
        return normalizeHostname(new URL(String(url)).hostname);
    } catch {
        return '';
    }
}

export function isHostAllowed(host, allowedHosts = [], { allowSubdomains = false } = {}) {
    const normalizedHost = normalizeHostname(host);
    return allowedHosts
        .map(normalizeHostname)
        .filter(Boolean)
        .some(allowedHost => normalizedHost === allowedHost || (allowSubdomains && normalizedHost.endsWith(`.${allowedHost}`)));
}

export async function validateExternalUrl(url, {
    protocols = ['https:'],
    allowedHosts = null,
    allowSubdomains = false,
    rejectNonDefaultPort = false,
    rejectSingleLabelHosts = true,
} = {}) {
    let parsedUrl;
    try {
        parsedUrl = new URL(String(url));
    } catch {
        throw new UrlSecurityError('Invalid URL');
    }

    if (!protocols.includes(parsedUrl.protocol)) {
        throw new UrlSecurityError('Invalid URL protocol');
    }

    if (!parsedUrl.hostname || !parsedUrl.host) {
        throw new UrlSecurityError('Invalid URL host');
    }

    if (parsedUrl.username || parsedUrl.password) {
        throw new UrlSecurityError('URL credentials are not allowed');
    }

    if (rejectNonDefaultPort && parsedUrl.port) {
        throw new UrlSecurityError('Non-standard URL ports are not allowed');
    }

    const hostname = normalizeHostname(parsedUrl.hostname);
    if (isInternalHostname(hostname)) {
        throw new UrlSecurityError('Internal hosts are not allowed');
    }

    if (rejectSingleLabelHosts && !hostname.includes('.')) {
        throw new UrlSecurityError('Single-label hosts are not allowed');
    }

    if (parseIpAddress(hostname)) {
        throw new UrlSecurityError('IP literal hosts are not allowed');
    }

    if (Array.isArray(allowedHosts) && !isHostAllowed(hostname, allowedHosts, { allowSubdomains })) {
        throw new UrlSecurityError('Host is not allowed', 404);
    }

    await assertPublicDnsResolution(hostname);
    return parsedUrl;
}

export async function safeFetch(url, init = {}, validationOptions = {}) {
    const maxRedirects = Number.isInteger(validationOptions.maxRedirects)
        ? Math.max(0, validationOptions.maxRedirects)
        : DEFAULT_MAX_REDIRECTS;
    let currentUrl = String(url);
    let currentInit = { ...init };

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
        const validatedUrl = await validateExternalUrl(currentUrl, validationOptions);
        const response = await fetch(validatedUrl.toString(), {
            ...currentInit,
            redirect: 'manual',
        });

        if (!REDIRECT_STATUSES.has(response.status)) {
            return response;
        }

        const location = response.headers.get('location');
        if (!location) {
            return response;
        }

        if (redirectCount === maxRedirects) {
            throw new UrlSecurityError('Too many redirects', 508);
        }

        currentUrl = new URL(location, validatedUrl).toString();
        if (response.status === 303) {
            const { headers } = currentInit;
            currentInit = { method: 'GET', headers };
        }
    }

    throw new UrlSecurityError('Too many redirects', 508);
}
