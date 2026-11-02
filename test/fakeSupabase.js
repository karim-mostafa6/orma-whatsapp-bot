// Supabase وهمي (PostgREST) للاختبارات: GET (like + Range)، POST upsert، DELETE in.(...)
import http from 'node:http';

export async function startFakeSupabase({ key = 'service-key', pageLimit = 1000 } = {}) {
  const rows = new Map();
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    const url = new URL(req.url, 'http://x');
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const jwt = key.startsWith('eyJ');
    const authOk = jwt ? req.headers.authorization === `Bearer ${key}` : req.headers.authorization === undefined;
    if (req.headers.apikey !== key || !authOk) return send(401, { message: 'Invalid API key' });
    if (!url.pathname.startsWith('/rest/v1/orma_kv')) return send(404, { message: 'relation "public.x" does not exist' });

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') {
        let list = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
        const like = url.searchParams.get('key');
        if (like?.startsWith('like.')) {
          const prefix = like.slice(5).replace(/\*$/, '');
          list = list.filter(([k]) => k.startsWith(prefix));
        }
        const limit = Number(url.searchParams.get('limit') || Infinity);
        const [from, to] = String(req.headers.range || `0-${pageLimit - 1}`).split('-').map(Number);
        const page = list.slice(from, Math.min(to + 1, from + pageLimit, from + limit)).map(([k, v]) => ({ key: k, value: v }));
        return send(200, page);
      }
      if (req.method === 'POST') {
        for (const r of JSON.parse(body)) rows.set(r.key, r.value);
        return send(201);
      }
      if (req.method === 'DELETE') {
        const m = (url.searchParams.get('key') || '').match(/^in\.\((.*)\)$/);
        if (m) for (const q of m[1].match(/"((?:[^"\\]|\\.)*)"/g) || []) rows.delete(JSON.parse(q));
        return send(204);
      }
      send(405, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    key,
    rows,
    get requests() {
      return requests;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
