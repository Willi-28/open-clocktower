import { readdir } from 'node:fs/promises';

const frontendDist = new URL('../../frontend/dist/', import.meta.url);
const files = await readdir(frontendDist, { recursive: true });
const packFiles = files.filter((file) => file.toLowerCase().endsWith('.zip'));

if (packFiles.length > 0) {
  throw new Error(`Desktop release contains character packs: ${packFiles.join(', ')}`);
}

console.log('release frontend check: OK - no character packs');
