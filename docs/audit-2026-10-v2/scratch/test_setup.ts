import os from 'os';
import path from 'path';

process.env.DATABASE_PATH = path.join(os.tmpdir(), 'erp-audit-test.sqlite');

import { resetTestDb, app, request, getDb } from '../../../tests/testApp.js';

async function main() {
  const db = resetTestDb();
  console.log('Database initialized:', db.name);
  const res = await request(app).get('/api/version');
  console.log('Version response:', res.status, res.body);
}

main().catch(console.error);
