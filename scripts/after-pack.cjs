const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('Apple signing identity configured; preserving electron-builder signature.');
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'physmap-sign-'));
  const cleanAppPath = path.join(tempRoot, appName);

  try {
    // Desktop/iCloud file providers can attach Finder metadata while Builder is
    // assembling the bundle. Sign a clean copy outside that filesystem, then
    // copy the valid bundle back without resource forks or extended metadata.
    execFileSync(
      'ditto',
      ['--norsrc', '--noextattr', '--noqtn', appPath, cleanAppPath],
      { stdio: 'inherit' },
    );
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', cleanAppPath],
      { stdio: 'inherit' },
    );
    execFileSync(
      'codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', cleanAppPath],
      { stdio: 'inherit' },
    );
    fs.rmSync(appPath, { recursive: true, force: true });
    execFileSync(
      'ditto',
      ['--norsrc', '--noextattr', '--noqtn', cleanAppPath, appPath],
      { stdio: 'inherit' },
    );
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
    execFileSync(
      'codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', appPath],
      { stdio: 'inherit' },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
