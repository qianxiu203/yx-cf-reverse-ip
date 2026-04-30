/**
 * Pages Function — /api/lookup
 *
 * 功能：输入 IP 反查域名，可选 DNS 解析 + 可访问性过滤
 * 数据来源自动轮换：hackertarget → ip138 → crt.sh → ipchaxun
 */

// ── Constants ────────────────────────────────

const ACCESSIBLE_TIMEOUT = 3000;
const ACCESSIBLE_BATCH_SIZE = 10;
const ACCESSIBLE_CHECK_LIMIT = 100;
const DNS_BATCH_SIZE = 15;
const CACHE_MAX_AGE = 300;
const GLOBAL_TIMEOUT_MS = 25000;

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// ── Messages ─────────────────────────────────

const MESSAGES = {
  MISSING_IP: '缺少 ip 参数',
  INVALID_IP: '无效的 IP 地址格式',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  INTERNAL_ERROR: '服务器内部错误',
};

// ── Data Sources ─────────────────────────────

const SOURCES = [
  {
    name: 'hackertarget',
    url: (ip) => `https://api.hackertarget.com/reverseiplookup/?q=${ip}`,
    parse: async (resp) => {
      const text = await resp.text();
      if (text.startsWith('API count')) throw new Error('rate limit');
      return text.split('\n').map(s => s.trim()).filter(s => s && !s.includes(' '));
    },
    headers: {},
  },
  {
    name: 'ip138',
    url: (ip) => `https://site.ip138.com/${ip}/`,
    parse: async (resp) => {
      const html = await resp.text();
      const matches = [...html.matchAll(/<a[^>]*href="https?:\/\/([^"'\/]+)[^"]*"[^>]*>/gi)];
      return [...new Set(matches.map(m => m[1].toLowerCase().replace(/^www\./, '')))].filter(d => d.includes('.'));
    },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  },
  {
    name: 'crt.sh',
    url: (ip) => `https://crt.sh/?q=ip:${ip}&output=json`,
    parse: async (resp) => {
      const data = await resp.json();
      if (!Array.isArray(data)) throw new Error('unexpected crt.sh response');
      return [...new Set(
        data
          .flatMap(e => [e.name_value])
          .flatMap(n => n?.split('\n') || [])
          .map(d => d.trim().toLowerCase().replace(/^\*\./, ''))
          .filter(d => d.includes('.'))
      )];
    },
    headers: { Accept: 'application/json' },
  },
  {
    name: 'ipchaxun',
    url: (ip) => `https://ipchaxun.com/${ip}/`,
    parse: async (resp) => {
      const html = await resp.text();
      const matches = [...html.matchAll(/<a[^>]*>(?:https?:\/\/)?([^<"\s]+\.[a-z]{2,})<\/a>/gi)];
      return [...new Set(matches.map(m => m[1].toLowerCase().replace(/^www\./, '')))].filter(d => d.includes('.'));
    },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  },
];

// ── Validation ────────────────────────────────

function isValidIPv4(str) {
  const match = str.match(IPV4_RE);
  if (!match) return false;
  return match.slice(1).every(octet => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

// ── Private IP Filtering ─────────────────────

function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 127.0.0.0/8
  if (parts[0] === 127) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 172.16.0.0/12 (only 172.16.x.x - 172.31.x.x)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

// ── DNS Lookup ───────────────────────────────

async function dnsLookup(domain) {
  const url = `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`;
  const resp = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!data.Answer) return [];
  return data.Answer
    .filter(r => r.type === 1)
    .map(r => r.data)
    .filter(ip => !isPrivateIP(ip));
}

// ── Accessibility Check ──────────────────────

async function checkAccessibility(domain) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACCESSIBLE_TIMEOUT);

  try {
    await fetch(`https://${domain}/`, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return true;
  } catch {
    try {
      await fetch(`http://${domain}/`, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Core Logic ────────────────────────────────

async function fetchDomainsFromSources(ip) {
  const domains = [];
  const sourceErrors = [];

  for (const source of SOURCES) {
    try {
      const resp = await fetch(source.url(ip), { headers: source.headers });
      if (!resp.ok) {
        sourceErrors.push({ source: source.name, error: `HTTP ${resp.status}` });
        continue;
      }
      const found = await source.parse(resp);
      for (const d of found) {
        domains.push({ domain: d, source: source.name });
      }
    } catch (err) {
      sourceErrors.push({ source: source.name, error: err.message });
      continue;
    }
  }

  return { domains, sourceErrors };
}

function deduplicateDomains(domains) {
  const seen = new Set();
  const unique = [];
  for (const d of domains) {
    const key = d.domain.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(d);
    }
  }
  return unique;
}

async function filterAccessibleDomains(uniqueDomains) {
  const domainNames = uniqueDomains.map(d => d.domain);
  const toCheck = domainNames.slice(0, ACCESSIBLE_CHECK_LIMIT);
  const accessibleSet = new Set();

  for (let i = 0; i < toCheck.length; i += ACCESSIBLE_BATCH_SIZE) {
    const batch = toCheck.slice(i, i + ACCESSIBLE_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(d => checkAccessibility(d)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled' && results[j].value === true) {
        accessibleSet.add(batch[j].toLowerCase());
      }
    }
  }

  return uniqueDomains.filter(d => accessibleSet.has(d.domain.toLowerCase()));
}

async function resolveDnsForDomains(uniqueDomains) {
  const domainNames = uniqueDomains.map(d => d.domain);
  const resolvedIps = [];

  for (let i = 0; i < domainNames.length; i += DNS_BATCH_SIZE) {
    const batch = domainNames.slice(i, i + DNS_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(d => dnsLookup(d)));
    for (const r of results) {
      if (r.status === 'fulfilled') resolvedIps.push(...r.value);
    }
  }

  return [...new Set(resolvedIps)].sort();
}

function responseHeaders(extra = {}) {
  return { ...JSON_HEADERS, ...SECURITY_HEADERS, ...extra };
}

// ── Rate Limiter (in-memory, per-worker) ─────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const ipRequests = new Map();

function checkRateLimit(clientIp) {
  const now = Date.now();
  const record = ipRequests.get(clientIp);
  if (!record || (now - record.start) > RATE_LIMIT_WINDOW_MS) {
    ipRequests.set(clientIp, { count: 1, start: now });
    return true;
  }
  record.count++;
  return record.count <= RATE_LIMIT_MAX;
}

export { isValidIPv4, isPrivateIP, deduplicateDomains, checkRateLimit, MESSAGES };

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const ip = url.searchParams.get('ip');
  const doDns = url.searchParams.get('dns') === '1';
  const doAccessible = url.searchParams.get('accessible') === '1';

  if (!ip) {
    return new Response(JSON.stringify({ error: MESSAGES.MISSING_IP }), {
      status: 400,
      headers: responseHeaders(),
    });
  }

  if (!isValidIPv4(ip)) {
    return new Response(JSON.stringify({ error: MESSAGES.INVALID_IP }), {
      status: 400,
      headers: responseHeaders(),
    });
  }

  // Rate limiting
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: MESSAGES.RATE_LIMITED }), {
      status: 429,
      headers: responseHeaders({ 'Retry-After': '60' }),
    });
  }

  try {
    const { domains, sourceErrors } = await fetchDomainsFromSources(ip);

    // Deduplicate (keep first source)
    let uniqueDomains = deduplicateDomains(domains);
    const rawDomainCount = uniqueDomains.length;

    // Optional: filter by accessibility
    if (doAccessible && uniqueDomains.length > 0) {
      uniqueDomains = await filterAccessibleDomains(uniqueDomains);
    }

    // Optional: DNS resolution
    let resolvedIps = [];
    if (doDns && uniqueDomains.length > 0) {
      resolvedIps = await resolveDnsForDomains(uniqueDomains);
    }

    const body = {
      ip,
      accessible: doAccessible,
      total_raw: rawDomainCount,
      total: uniqueDomains.length,
      sources: [...new Set(uniqueDomains.map(d => d.source))],
      domains: uniqueDomains,
      ips: resolvedIps,
    };
    if (sourceErrors.length > 0) body.source_errors = sourceErrors;

    return new Response(JSON.stringify(body), {
      headers: responseHeaders({ 'Cache-Control': `public, max-age=${CACHE_MAX_AGE}` }),
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: MESSAGES.INTERNAL_ERROR }), {
      status: 500,
      headers: responseHeaders(),
    });
  }
}
