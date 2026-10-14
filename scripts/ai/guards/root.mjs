import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, derived from this file's location so it works from any working directory. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
