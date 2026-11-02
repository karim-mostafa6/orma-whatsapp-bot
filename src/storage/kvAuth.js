// جلسة الواتساب (Baileys) محفوظة في kv بدل فولدر auth/ — نفس شغل useMultiFileAuthState بالظبط.
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

const PREFIX = 'auth:';

/** @param {ReturnType<import('./supabaseKv.js').createSupabaseKv>} kv */
export async function useKvAuthState(kv) {
  const cache = await kv.loadAll(PREFIX); // key → JSON string
  const read = (k) => (cache.has(k) ? JSON.parse(cache.get(k), BufferJSON.reviver) : null);
  const write = (k, value) => {
    const s = JSON.stringify(value, BufferJSON.replacer);
    cache.set(k, s);
    kv.set(k, s);
  };
  const remove = (k) => {
    cache.delete(k);
    kv.del(k);
  };

  const creds = read(`${PREFIX}creds`) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = read(`${PREFIX}${type}-${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const k = `${PREFIX}${category}-${id}`;
              if (value) write(k, value);
              else remove(k);
            }
          }
        },
      },
    },
    saveCreds: async () => write(`${PREFIX}creds`, creds),
    /** فك الربط: نمسح الجلسة كلها */
    clear: async () => {
      for (const k of [...cache.keys()]) remove(k);
      await kv.flushNow();
    },
  };
}
