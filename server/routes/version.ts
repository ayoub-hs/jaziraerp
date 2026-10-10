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

export function getServerBuildId(): string {
  if (process.env.BUILD_ID && process.env.BUILD_ID.trim()) {
    return process.env.BUILD_ID.trim();
  }
  try {
    const buildFilePath = path.resolve(__dirname, '../../dist/build-id.txt');
    if (fs.existsSync(buildFilePath)) {
      const fileId = fs.readFileSync(buildFilePath, 'utf8').trim();
      if (fileId) return fileId;
    }
  } catch {}
  return `build-${packageVersion}`;
}

export const SERVER_BUILD_ID = getServerBuildId();

versionRouter.get('/', (req, res) => {
  res.json({
    version: packageVersion,
    build_id: getServerBuildId(),
    timestamp: new Date().toISOString()
  });
});
