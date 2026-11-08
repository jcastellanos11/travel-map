// Research only: reuse existing isolated tools; no application dependency changes.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../tools/package.json', import.meta.url));
export const sharp = require('sharp');
export const exifr = require('exifr');
