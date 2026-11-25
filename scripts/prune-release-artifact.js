'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const NEXT_DIR = path.join(REPO_ROOT, 'apps', 'web', '.next');
const NEXT_CACHE_DIR = path.join(NEXT_DIR, 'cache');

function getDirBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  }
  return total;
}

function toMiB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function pruneRuntimeArtifact({ dryRun = false } = {}) {
  const beforeNextBytes = getDirBytes(NEXT_DIR);
  const cacheBytes = getDirBytes(NEXT_CACHE_DIR);
  if (!dryRun && fs.existsSync(NEXT_CACHE_DIR)) {
    fs.rmSync(NEXT_CACHE_DIR, { recursive: true, force: true });
  }
  const afterNextBytes = dryRun ? beforeNextBytes - cacheBytes : getDirBytes(NEXT_DIR);
  const publicBytes = getDirBytes(path.join(REPO_ROOT, 'apps', 'web', 'public'));
  const pgClientBytes = getDirBytes(path.join(REPO_ROOT, 'packages', 'database', 'generated', 'postgres-client'));

  return {
    beforeNextMiB: toMiB(beforeNextBytes),
    prunedCacheMiB: toMiB(cacheBytes),
    afterNextMiB: toMiB(afterNextBytes),
    publicBrandMiB: toMiB(publicBytes),
    prismaPgClientMiB: toMiB(pgClientBytes),
    totalRuntimeArtifactMiB: toMiB(afterNextBytes + publicBytes + pgClientBytes),
  };
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const summary = pruneRuntimeArtifact({ dryRun });
  console.log('[artifact:prune]', JSON.stringify(summary));
}

module.exports = { pruneRuntimeArtifact };
