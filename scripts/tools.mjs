// Pinned, project-local command-line tools. They live in .tools/ (git-ignored) so the project
// stays self-contained: nothing is installed system-wide. `npm run bootstrap` downloads them.
// To upgrade a tool: change its version and its SHA-256 here together, in one reviewed commit.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS_DIR = join(ROOT, '.tools');

const exe = process.platform === 'win32' ? '.exe' : '';

/**
 * `assets` maps `${process.platform}-${process.arch}` to the release file and its SHA-256,
 * copied from the publisher's checksum list for that release.
 */
export const TOOLS = {
  gitleaks: {
    version: '8.30.1',
    binary: join(TOOLS_DIR, 'gitleaks', `gitleaks${exe}`),
    url: (version, file) =>
      `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${file}`,
    assets: {
      'win32-x64': {
        file: 'gitleaks_8.30.1_windows_x64.zip',
        sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
      },
      'linux-x64': {
        file: 'gitleaks_8.30.1_linux_x64.tar.gz',
        sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
      },
    },
  },
  gh: {
    version: '2.102.0',
    binary: join(TOOLS_DIR, 'gh', 'bin', `gh${exe}`),
    url: (version, file) => `https://github.com/cli/cli/releases/download/v${version}/${file}`,
    assets: {
      'win32-x64': {
        file: 'gh_2.102.0_windows_amd64.zip',
        sha256: 'ae64e556ecc240b200f7eba60d550e4bb60d78e860e69dd88c449405b86067f4',
      },
    },
  },
};

/** @param {keyof typeof TOOLS} name @returns {string | null} path to the binary if installed */
export function toolPath(name) {
  const tool = TOOLS[name];
  return existsSync(tool.binary) ? tool.binary : null;
}
