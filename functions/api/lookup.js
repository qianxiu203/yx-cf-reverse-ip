/**
 * Pages Function — /api/lookup
 *
 * 功能：输入 IP 反查域名，可选 DNS 解析
 * 数据来源自动轮换：hackertarget → ip138 → crt.sh → ipchaxun
 */

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
    .filter(ip => !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('192.168.') && !ip.startsWith('172.'));
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const ip = url.searchParams.get('ip');
  const doDns = url.searchParams.get('dns') === '1';

  if (!ip) {
    return new Response(JSON.stringify({ error: '缺少 ip 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const domains = [];

    for (const source of SOURCES) {
      try {
        const resp = await fetch(source.url(ip), { headers: source.headers });
        if (!resp.ok) continue;
        const found = await source.parse(resp);
        for (const d of found) {
          domains.push({ domain: d, source: source.name });
        }
      } catch {
        // 失败就换下一个来源
        continue;
      }
    }

    // 去重（保留第一个 source）
    const seen = new Set();
    const uniqueDomains = [];
    for (const d of domains) {
      const key = d.domain.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDomains.push(d);
      }
    }

    // 可选：DNS 解析
    let resolvedIps = [];
    if (doDns && uniqueDomains.length > 0) {
      const domainNames = uniqueDomains.map(d => d.domain);
      const batchSize = 15;
      for (let i = 0; i < domainNames.length; i += batchSize) {
        const batch = domainNames.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(d => dnsLookup(d)));
        for (const r of results) {
          if (r.status === 'fulfilled') resolvedIps.push(...r.value);
        }
      }
      resolvedIps = [...new Set(resolvedIps)].sort();
    }

    return new Response(JSON.stringify({
      ip,
      total: uniqueDomains.length,
      sources: [...new Set(uniqueDomains.map(d => d.source))],
      domains: uniqueDomains,
      ips: resolvedIps,
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
