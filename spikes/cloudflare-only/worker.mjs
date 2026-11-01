import { createHandler } from '../shared/native-handler.mjs';
export default { fetch: createHandler(async (env) => ({
  all: async (sql,params=[]) => (await env.DB.prepare(sql).bind(...params).all()).results,
  run: async (sql,params=[]) => env.DB.prepare(sql).bind(...params).run(),
  batch: async (items) => env.DB.batch(items.map(([sql,params]) => env.DB.prepare(sql).bind(...params))),
}), 'D1') };
