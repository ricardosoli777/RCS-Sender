import { Pool } from 'pg';
import { loadServerConfig } from '@rcs/config';
import { migrate } from './index.js';

const config = loadServerConfig(process.env);
const pool = new Pool({ connectionString: config.DATABASE_URL });
try {
  const applied = await migrate(pool);
  process.stdout.write(applied.length ? `Migrações aplicadas: ${applied.join(', ')}\n` : 'Banco já atualizado.\n');
} finally {
  await pool.end();
}

