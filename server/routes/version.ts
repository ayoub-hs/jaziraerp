import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const versionRouter = Router();

let packageVersion = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  if (pkg.version) packageVersion = pkg.version;
} catch {
  // fallback
}

export const SERVER_BUILD_ID = process.env.BUILD_ID || `build-${packageVersion}`;

versionRouter.get('/', (req, res) => {
  res.json({
    version: packageVersion,
    build_id: SERVER_BUILD_ID,
    timestamp: new Date().toISOString()
  });
});
