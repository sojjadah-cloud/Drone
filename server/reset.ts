// Deletes the local database and uploaded files, then reseeds demo data.
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.env.FIREGUARD_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'data');
rmSync(dir, { recursive: true, force: true });
const { seedIfEmpty } = await import('./seed.ts');
seedIfEmpty();
console.log('[fireguard] database reset and demo data seeded');
