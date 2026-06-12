const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  // Apple Silicon requires a coherent signature across the complete Electron
  // bundle, even when no paid Developer ID certificate is available.
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  );
  execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { stdio: 'inherit' },
  );
};
