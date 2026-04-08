const { join } = require('path');
const sharp = require('sharp');

const root = join(__dirname, '..');
const svgPath = join(root, 'resources/app-icon.svg');
const outPath = join(root, 'public/icon.png');

sharp(svgPath)
  .resize(1024, 1024)
  .png()
  .toFile(outPath)
  .then(() => console.warn('Wrote', outPath))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
