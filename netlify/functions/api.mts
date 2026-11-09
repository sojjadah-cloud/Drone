// Netlify Function: serves /api/* using the shared ResQAir handler, with state in Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { handle } from '../../server/handler.ts';
import type { State } from '../../shared/campus.ts';

export default async (req: Request) => {
  const store = getStore({ name: 'resqair', consistency: 'strong' });
  return handle(req, {
    load: async () => ((await store.get('state', { type: 'json' })) as State | null) ?? null,
    save: async (s) => void (await store.setJSON('state', s)),
  });
};

export const config = { path: '/api/*' };
