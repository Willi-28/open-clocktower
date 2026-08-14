import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo root from this script's own location (scripts/ sits directly
// under the root) instead of process.cwd(). Otherwise, invoked through the
// frontend npm script, the walk only ever sees apps/frontend and the Python
// risky-pattern rules never run against the backend.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirs = new Set([
  '.git',
  '.codex',
  '.agents',
  '.npm-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  '.vite',
  'coverage',
  'dist',
  'htmlcov',
  'node_modules',
  '__pycache__',
  // Desktop (Electron) build outputs — bundled/minified artifacts, not source
  // (gitignored). Scanning them trips the risky-pattern rules.
  'build',
  'release',
]);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.py', '.css', '.json', '.md', '.yml', '.yaml']);
const riskyPatterns = [
  { pattern: /\bdangerouslySetInnerHTML\b/, message: 'React raw HTML rendering' },
  { pattern: /\beval\s*\(/, message: 'eval usage' },
  { pattern: /\bnew\s+Function\s*\(/, message: 'dynamic Function constructor' },
  { pattern: /\.innerHTML\s*=/, message: 'direct innerHTML assignment' },
  { pattern: /\bdocument\.write\s*\(/, message: 'document.write usage' },
  { pattern: /\bpickle\.loads?\s*\(/, message: 'Python pickle deserialization' },
  { pattern: new RegExp(String.raw`shell\s*=\s*True`), message: 'Python subprocess shell option enabled' },
];

function extension(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path, files);
    } else if (sourceExtensions.has(extension(path))) {
      files.push(path);
    }
  }
  return files;
}

const failures = [];
const complexityNotes = [];

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const rel = relative(root, file);
  lines.forEach((line, index) => {
    if (/[ \t]$/.test(line)) {
      failures.push(`${rel}:${index + 1} trailing whitespace`);
    }
  });
  for (const { pattern, message } of riskyPatterns) {
    if (pattern.test(text)) {
      failures.push(`${rel}: ${message}`);
    }
  }
  if ((file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.py')) && lines.length > 700) {
    complexityNotes.push(`${rel}: ${lines.length} lines; consider splitting by responsibility`);
  }
}

if (complexityNotes.length > 0) {
  console.warn('Complexity notes:');
  complexityNotes.forEach((note) => console.warn(`- ${note}`));
}

if (failures.length > 0) {
  console.error('Static analysis failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Static analysis passed.');
