const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function runPowerShell(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${executable} exited with code ${code}`));
    });
  });
}

async function runPatchScript(scriptPath, exePath, iconPath) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ExePath',
    exePath,
    '-IconPath',
    iconPath,
  ];

  try {
    await runPowerShell('pwsh.exe', args);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
    await runPowerShell('powershell.exe', args);
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = context.packager.projectDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(projectDir, 'assets', 'icon.ico');
  const scriptPath = path.join(projectDir, 'scripts', 'patch-win-icon.ps1');

  if (!fs.existsSync(exePath)) {
    throw new Error(`Cannot patch Windows icon because the EXE is missing: ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Cannot patch Windows icon because the ICO is missing: ${iconPath}`);
  }

  await runPatchScript(scriptPath, exePath, iconPath);
  console.log(`  • patched Windows icon  file=${exePath}`);
};
