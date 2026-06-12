import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'build', 'icon.svg');
const buildDir = path.join(root, 'build');
const linuxDir = path.join(buildDir, 'icons');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

await mkdir(linuxDir, { recursive: true });
await rm(iconsetDir, { recursive: true, force: true });
await mkdir(iconsetDir, { recursive: true });

for (const size of pngSizes) {
  const output = path.join(linuxDir, `${size}x${size}.png`);
  await sharp(source).resize(size, size).png().toFile(output);
}

await sharp(source).resize(512, 512).png().toFile(path.join(buildDir, 'icon.png'));

const icoInputs = [16, 24, 32, 48, 64, 128, 256].map((size) =>
  path.join(linuxDir, `${size}x${size}.png`),
);
await writeFile(path.join(buildDir, 'icon.ico'), await pngToIco(icoInputs));

if (process.platform === 'darwin') {
  const iconsetSizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];

  for (const [size, name] of iconsetSizes) {
    await sharp(source).resize(size, size).png().toFile(path.join(iconsetDir, name));
  }
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')]);
  await rm(iconsetDir, { recursive: true, force: true });
}

console.log('PhysMap desktop icons generated.');
