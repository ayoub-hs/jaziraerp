import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

export function computeBuildId() {
  if (process.env.BUILD_ID && process.env.BUILD_ID.trim()) {
    return process.env.BUILD_ID.trim();
  }
  let gitShort = '';
  try {
    gitShort = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {}

  const timestamp = Date.now();
  return gitShort ? `${gitShort}-${timestamp}` : `build-${timestamp}`;
}

export function writeBuildId(buildId = computeBuildId()) {
  const distDir = path.resolve(root, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  fs.writeFileSync(path.resolve(distDir, 'build-id.txt'), buildId, 'utf8');
  return buildId;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = writeBuildId();
  console.log(`[build-id] Generated: ${id}`);
}
