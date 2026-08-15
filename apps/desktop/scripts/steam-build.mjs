/**
 * One-command Steam build.
 *
 * Produces a depot-ready folder and refuses to hand it over unless it passes
 * every check, so an upload can never carry stale UI, a leftover failed build,
 * or the dev-only steam_appid.txt that would override the real App ID.
 *
 *   node scripts/steam-build.mjs              clean depot build + verification
 *   node scripts/steam-build.mjs --dev-appid  same, plus steam_appid.txt for
 *                                             local overlay testing (NOT
 *                                             uploadable — the check refuses it)
 *   node scripts/steam-build.mjs --skip-frontend   reuse the existing dist
 *   node scripts/steam-build.mjs --verify-only     re-check release/ without
 *                                                  rebuilding anything
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(desktopDir, '..', '..');
const frontendDistDir = path.join(repoDir, 'apps', 'frontend', 'dist');
const releaseDir = path.join(desktopDir, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const steamOutDir = path.join(releaseDir, 'steam');

const args = new Set(process.argv.slice(2));
const devAppId = args.has('--dev-appid');
const skipFrontend = args.has('--skip-frontend');
const verifyOnly = args.has('--verify-only');

const problems = [];
let step = 0;

function heading(text) {
  step += 1;
  console.log(`\n[1m${step}. ${text}[0m`);
}

function ok(text) {
  console.log(`   [32mok[0m    ${text}`);
}

function fail(text) {
  problems.push(text);
  console.log(`   [31mFAIL[0m  ${text}`);
}

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

/** Every file below dir, as repo-style relative paths. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Content fingerprint of a directory tree: names and bytes, order-independent. */
function hashTree(dir) {
  const hash = crypto.createHash('sha256');
  for (const rel of walk(dir).sort()) {
    hash.update(rel);
    hash.update(fs.readFileSync(path.join(dir, rel)));
  }
  return hash.digest('hex');
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- preflight

heading('Preflight');

const licensePath = path.join(repoDir, 'LICENSE');
const noticesPath = path.join(repoDir, 'THIRD-PARTY-NOTICES.md');

if (!fs.existsSync(licensePath) || /TODO: Choose a license/i.test(fs.readFileSync(licensePath, 'utf8'))) {
  fail('LICENSE is missing or still the placeholder.');
} else {
  ok('LICENSE present.');
}
if (fs.existsSync(noticesPath)) {
  ok('THIRD-PARTY-NOTICES.md present.');
} else {
  fail('THIRD-PARTY-NOTICES.md is missing (required attribution for Twemoji/fonts).');
}

if (problems.length > 0) {
  console.error('\nPreflight failed. Fix the above before building.');
  process.exit(1);
}

// ------------------------------------------------------------------- clean

heading('Clean release/');

if (verifyOnly) {
  ok('--verify-only: keeping the existing release/ directory.');
} else if (fs.existsSync(releaseDir)) {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    ok('Removed the previous release/ directory.');
  } catch (error) {
    console.error(
      `\nCould not delete ${releaseDir}: ${error.message}\n` +
        'This normally means a previously built OpenClocktower.exe is still running. ' +
        'Close it and run this again — a stale release/ must never be uploaded.',
    );
    process.exit(1);
  }
} else {
  ok('No previous release/ directory.');
}

// ------------------------------------------------------------------- build

if (!verifyOnly) {
  if (skipFrontend) {
    heading('Rebuild the bundled frontend (skipped)');
    console.log('   --skip-frontend: reusing apps/frontend/dist as it is.');
  } else {
    heading('Rebuild the bundled frontend');
    await run('npm', ['--prefix', path.join(repoDir, 'apps', 'frontend'), 'run', 'build'], repoDir);
  }

  heading('Package the Electron app');
  await run('npx', ['electron-builder', '--dir', '--config.win.signAndEditExecutable=false'], desktopDir);
}

// ------------------------------------------------------------------ verify

heading('Verify the depot content');

const exePath = path.join(unpackedDir, 'OpenClocktower.exe');
if (fs.existsSync(exePath)) {
  ok('OpenClocktower.exe built.');
} else {
  fail('OpenClocktower.exe is missing.');
}

const strayBuilds = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'win-unpacked' && entry.name !== 'steam');
if (strayBuilds.length === 0) {
  ok('No leftover build directories in release/.');
} else {
  fail(`release/ also contains: ${strayBuilds.map((entry) => entry.name).join(', ')}`);
}

const unpackedFiles = fs.existsSync(unpackedDir) ? walk(unpackedDir) : [];

const appIdFiles = unpackedFiles.filter((rel) => rel.toLowerCase().endsWith('steam_appid.txt'));
if (appIdFiles.length === 0) {
  ok('No steam_appid.txt — Steam supplies the App ID at launch.');
} else if (devAppId) {
  console.log(`   [33mdev[0m   steam_appid.txt present for local testing: ${appIdFiles.join(', ')}`);
} else {
  fail(`steam_appid.txt would override the real App ID: ${appIdFiles.join(', ')}`);
}

const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
if (fs.existsSync(asarPath)) {
  // The asar file table is JSON at the head of the archive.
  const head = fs.readFileSync(asarPath).subarray(0, 262144).toString('latin1');
  if (head.includes('steam_appid')) {
    fail('app.asar still contains steam_appid.txt (check the files list in electron-builder.yml).');
  } else {
    ok('app.asar carries no steam_appid.txt.');
  }
}

for (const required of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) {
  if (unpackedFiles.includes(required)) {
    ok(`${required} ships with the build.`);
  } else {
    fail(`${required} is missing from the build.`);
  }
}

const bundledFrontendDir = path.join(unpackedDir, 'resources', 'frontend');
if (!fs.existsSync(path.join(bundledFrontendDir, 'index.html'))) {
  fail('The bundled frontend is missing from resources/frontend.');
} else if (hashTree(bundledFrontendDir) === hashTree(frontendDistDir)) {
  ok('Bundled frontend is byte-identical to apps/frontend/dist.');
} else {
  fail('The bundled frontend does not match apps/frontend/dist — the snapshot is stale.');
}

const totalBytes = unpackedFiles.reduce((sum, rel) => sum + fs.statSync(path.join(unpackedDir, rel)).size, 0);
console.log(`\n   Depot content: ${unpackedFiles.length} files, ${formatSize(totalBytes)}`);
console.log(`   ${unpackedDir}`);

if (devAppId) {
  fs.copyFileSync(path.join(desktopDir, 'steam_appid.txt'), path.join(unpackedDir, 'steam_appid.txt'));
  console.log('\n   [33mThis is a LOCAL TEST build (steam_appid.txt added). Do not upload it.[0m');
}

// -------------------------------------------------------------- depot vdfs

heading('Generate the SteamPipe scripts');

const config = JSON.parse(fs.readFileSync(path.join(desktopDir, 'steam', 'steam.config.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).version;
/** A Steamworks id, or null when it has not been filled in yet. */
function steamId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const appId = steamId(config.appId);
const depotId = steamId(config.depotId);

if (appId === null || depotId === null) {
  console.log('   steam/steam.config.json has no appId/depotId yet — skipping the .vdf files.');
  console.log('   Fill them in after Steamworks issues the App ID; nothing else has to change.');
} else if (appId === 480) {
  fail('steam/steam.config.json still points at App 480 (Spacewar).');
} else {
  fs.mkdirSync(steamOutDir, { recursive: true });
  const buildOutput = path.join(steamOutDir, 'output');
  const depotFile = `depot_build_${depotId}.vdf`;

  fs.writeFileSync(
    path.join(steamOutDir, `app_build_${appId}.vdf`),
    `"appbuild"\n{\n\t"appid" "${appId}"\n\t"desc" "Open Clocktower ${version}"\n\t"buildoutput" "${buildOutput}"\n\t"contentroot" "${unpackedDir}"\n\t"setlive" "${config.branch ?? ''}"\n\t"depots"\n\t{\n\t\t"${depotId}" "${depotFile}"\n\t}\n}\n`,
  );
  fs.writeFileSync(
    path.join(steamOutDir, depotFile),
    `"DepotBuildConfig"\n{\n\t"DepotID" "${depotId}"\n\t"contentroot" "${unpackedDir}"\n\t"FileMapping"\n\t{\n\t\t"LocalPath" "*"\n\t\t"DepotPath" "."\n\t\t"recursive" "1"\n\t}\n\t"FileExclusion" "*.pdb"\n}\n`,
  );
  ok(`Wrote app_build_${appId}.vdf and ${depotFile} to release/steam/.`);

  const account = config.steamcmdAccount || '<steam-account>';
  console.log(
    `\n   Upload with:\n   steamcmd +login ${account} +run_app_build "${path.join(steamOutDir, `app_build_${appId}.vdf`)}" +quit`,
  );
  if (!config.branch) {
    console.log('   ("branch" is empty, so the build uploads without going live — set it live in Steamworks.)');
  }
}

// ------------------------------------------------------------------ result

if (problems.length > 0) {
  console.error(`\n[31m${problems.length} problem(s) — this build must not be uploaded.[0m`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  devAppId
    ? '\n[33mLocal test build ready (not uploadable).[0m'
    : '\n[32mBuild verified and ready to upload.[0m',
);
