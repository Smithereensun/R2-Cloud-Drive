import assert from 'node:assert/strict';
import worker from '../worker.js';

function createKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix = '', cursor = '', limit = 1000 } = {}) {
      const keys = [...map.keys()].filter(key => key.startsWith(prefix)).sort();
      const offset = Number(cursor || 0);
      const page = keys.slice(offset, offset + limit);
      return {
        keys: page.map(name => ({ name })),
        cursor: offset + limit < keys.length ? String(offset + limit) : undefined
      };
    }
  };
}

function createR2() {
  const objects = new Map();
  return {
    async head(key) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        size: obj.bytes.byteLength,
        etag: obj.etag,
        uploaded: obj.uploaded,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata || {}
      };
    },
    async put(key, body, options = {}) {
      const bytes = body
        ? new Uint8Array(await new Response(body).arrayBuffer())
        : new Uint8Array();
      const meta = {
        bytes,
        etag: `"${key}:${bytes.byteLength}"`,
        uploaded: new Date(),
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {}
      };
      objects.set(key, meta);
      return {
        key,
        size: bytes.byteLength,
        etag: meta.etag,
        uploaded: meta.uploaded,
        httpMetadata: meta.httpMetadata,
        customMetadata: meta.customMetadata
      };
    },
    async get(key) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        body: new Response(obj.bytes).body,
        size: obj.bytes.byteLength,
        etag: obj.etag,
        uploaded: obj.uploaded,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata || {},
        async arrayBuffer() {
          return obj.bytes.buffer.slice(obj.bytes.byteOffset, obj.bytes.byteOffset + obj.bytes.byteLength);
        }
      };
    },
    async delete(key) {
      objects.delete(key);
    },
    async list() {
      return {
        objects: [...objects.entries()].map(([key, obj]) => ({
          key,
          size: obj.bytes.byteLength,
          uploaded: obj.uploaded
        })),
        truncated: false
      };
    }
  };
}

const env = {
  ACCESS_PASSWORD: 'secret',
  CLIPBOARD_KV: createKv(),
  R2_BUCKET: createR2()
};
const ctx = { waitUntil() {} };

function auth() {
  return 'Basic ' + Buffer.from('user:secret').toString('base64');
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.auth !== false) headers.set('Authorization', auth());
  return worker.fetch(new Request('https://example.com' + path, {
    ...init,
    headers
  }), env, ctx);
}

let res = await request('/webdav/', { method: 'PROPFIND', auth: false });
assert.equal(res.status, 401);
assert.equal(res.headers.get('WWW-Authenticate')?.includes('Basic'), true);

res = await request('/webdav/docs', { method: 'MKCOL' });
assert.equal(res.status, 201);

res = await request('/webdav/docs/hello.txt', {
  method: 'PUT',
  body: 'hello webdav',
  headers: { 'Content-Type': 'text/plain' }
});
assert.equal(res.status, 201);

res = await request('/webdav/docs/', {
  method: 'PROPFIND',
  headers: { Depth: '1' }
});
assert.equal(res.status, 207);
const listing = await res.text();
assert.match(listing, /hello\.txt/);
assert.match(listing, /<D:collection\/>/);

res = await request('/webdav/docs/hello.txt', { method: 'GET' });
assert.equal(res.status, 200);
assert.equal(await res.text(), 'hello webdav');

res = await request('/webdav/docs/hello.txt', {
  method: 'COPY',
  headers: { Destination: 'https://example.com/webdav/docs/copy.txt' }
});
assert.equal(res.status, 201);

res = await request('/webdav/docs/copy.txt', {
  method: 'MOVE',
  headers: { Destination: 'https://example.com/webdav/docs/moved.txt' }
});
assert.equal(res.status, 201);

res = await request('/webdav/docs/moved.txt', { method: 'DELETE' });
assert.equal(res.status, 204);

res = await request('/webdav/docs/moved.txt', { method: 'GET' });
assert.equal(res.status, 404);

console.log('webdav smoke ok');
