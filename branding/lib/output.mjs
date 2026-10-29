// Where the branding scripts put what they make (print PDFs, previews, cards, concepts): outside
// the repo, in ~/Documents/Sri Mana Wash/Branding, in the same folders as here. Git keeps only the
// scripts and the sources other scripts read: the logo files, the master mark, the app-icon art
// and the fonts. Set BRANDING_OUT to put the files somewhere else.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const BRANDING_OUT = process.env.BRANDING_OUT ?? join(homedir(), 'Documents', 'Sri Mana Wash', 'Branding');

/** The output folder for a script's folder `here` (and an optional subfolder), made if missing. */
export function outputDir(here, ...sub) {
  const dir = join(BRANDING_OUT, relative(ROOT, here), ...sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}
