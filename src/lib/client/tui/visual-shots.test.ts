import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PREMADE_THEMES } from './themes.js';
import {
  requireSafeShotFile,
  VISUAL_WIDTHS,
  visualGalleryPath,
  visualShotName,
  visualShotPlan,
} from './visual-shots.js';

// Contract: the 24 screenshot names. A bad id or a bad width throws.
// A file name is one safe segment. Shots do not use the clock or the network.

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SNAPSHOT_DIR = path.join(ROOT, 'e2e/gallery-visual.test.ts-snapshots');
const SAFE_SHOT_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:360|1440)\.png$/;
const UNSAFE_IDS = [
  '../etc/passwd',
  '..\\..\\windows\\win.ini',
  'nord/../../etc/passwd',
  'nord\\..\\secret',
  'Nord',
  'HIGH-CONTRAST',
  'nord\u0000',
  'nord\n',
  'nord\r\nSet-Cookie: evil=1',
  '<script>',
  'javascript:alert(1)',
  'https://evil.example',
  'ノード',
  'n\u200bord',
  '\ufeffnord',
  'phosphor-green ',
  '',
  'a'.repeat(80),
  'phosphor.green',
  'nope',
];
const UNSAFE_FILES = [
  '../etc/passwd-360.png',
  '..\\secret-360.png',
  'nord/360.png',
  'nord-360.png/../x.png',
  'Nord-360.png',
  'nord-720.png',
  'nord-360.PNG',
  'nord-360.png\u0000',
  'nord-360.png\n',
  '<script>-360.png',
  'javascript:alert(1)-360.png',
  '',
  '.',
  '..',
  'con.png',
];

function planFiles(): string[] {
  return visualShotPlan().map((shot) => shot.file);
}

function staysInSnapshotDir(fileName: string): boolean {
  const root = path.resolve('/snapshot');
  const resolved = path.resolve(root, fileName);
  return resolved.startsWith(root + path.sep);
}

function pngHasTextChunk(bytes: Buffer): boolean {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return true;
  }
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt' || type === 'eXIf') {
      return true;
    }
    offset += 12 + length;
  }
  return false;
}

describe('visualShotPlan', () => {
  it('returns 24 names in theme order, 360 then 1440', () => {
    const files = planFiles();
    expect(files).toHaveLength(24);
    expect(files[0]).toBe('phosphor-green-360.png');
    expect(files[1]).toBe('phosphor-green-1440.png');
    expect(files[23]).toBe('high-contrast-1440.png');
    expect(VISUAL_WIDTHS).toEqual([360, 1440]);
  });

  it('uses each catalog id twice and keeps the names unique', () => {
    const plan = visualShotPlan();
    const files = plan.map((shot) => shot.file);
    expect(new Set(files).size).toBe(files.length);
    for (const theme of PREMADE_THEMES) {
      const rows = plan.filter((shot) => shot.id === theme.id);
      expect(rows.map((shot) => shot.width)).toEqual([360, 1440]);
      expect(rows.map((shot) => shot.themeName)).toEqual([theme.name, theme.name]);
      expect(rows.map((shot) => shot.file)).toEqual([
        `${theme.id}-360.png`,
        `${theme.id}-1440.png`,
      ]);
    }
  });

  it('keeps every file name inside the snapshot directory', () => {
    for (const fileName of planFiles()) {
      expect(fileName).toMatch(SAFE_SHOT_FILE);
      expect(path.basename(fileName)).toBe(fileName);
      expect(staysInSnapshotDir(fileName)).toBe(true);
      expect(requireSafeShotFile(fileName)).toBe(fileName);
    }
  });
});

describe('visualShotName', () => {
  it('throws bad_theme for an id that is not in the catalog', () => {
    expect(() => visualShotName('nope', 360)).toThrow(new Error('bad_theme'));
  });

  it('throws bad_width for a width that is not 360 or 1440', () => {
    expect(() => visualShotName('nord', 720)).toThrow(new Error('bad_width'));
    for (const width of [
      0,
      -1,
      359,
      361,
      1439,
      1441,
      360.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => visualShotName('nord', width)).toThrow(new Error('bad_width'));
    }
  });

  it.each(UNSAFE_IDS)('throws bad_theme for %j', (themeId) => {
    expect(() => visualShotName(themeId, 360)).toThrow(new Error('bad_theme'));
    expect(() => visualGalleryPath(themeId)).toThrow(new Error('bad_theme'));
  });

  it('rejects a theme id that is not a string', () => {
    expect(() => visualShotName(['nord'] as unknown as string, 360)).toThrow(
      new Error('bad_theme'),
    );
    expect(() => visualShotName({ toString: () => 'nord' } as unknown as string, 360)).toThrow(
      new Error('bad_theme'),
    );
  });
});

describe('requireSafeShotFile', () => {
  it.each(UNSAFE_FILES)('throws bad_theme for %j', (fileName) => {
    expect(() => requireSafeShotFile(fileName)).toThrow(new Error('bad_theme'));
    expect(staysInSnapshotDir(fileName) && SAFE_SHOT_FILE.test(fileName)).toBe(false);
  });

  it('accepts only a safe file name from a random string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        try {
          const fileName = requireSafeShotFile(value);
          return SAFE_SHOT_FILE.test(fileName) && staysInSnapshotDir(fileName);
        } catch (error: unknown) {
          return error instanceof Error && error.message === 'bad_theme';
        }
      }),
      { seed: 1, numRuns: 100 },
    );
  });
});

describe('visualGalleryPath', () => {
  it('builds a catalog path and encodes nothing extra', () => {
    expect(visualGalleryPath('nord')).toBe('/gallery?theme=nord');
    expect(visualGalleryPath('phosphor-green')).toBe('/gallery?theme=phosphor-green');
    expect(visualGalleryPath('vt100-white-on-black')).toBe('/gallery?theme=vt100-white-on-black');
  });

  it('returns a catalog path or throws bad_theme', () => {
    const catalog = new Set(PREMADE_THEMES.map((theme) => theme.id));
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        try {
          const galleryPath = visualGalleryPath(value);
          return catalog.has(value) && galleryPath === `/gallery?theme=${value}`;
        } catch (error: unknown) {
          return error instanceof Error && error.message === 'bad_theme';
        }
      }),
      { seed: 1, numRuns: 100 },
    );
  });
});

describe('visual shot files', () => {
  it('stores 24 snapshots with no text secret', () => {
    const names = readdirSync(SNAPSHOT_DIR)
      .filter((name) => name.endsWith('.png'))
      .sort();
    expect(names).toHaveLength(24);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*-(?:360|1440)-chromium-linux\.png$/);
      expect(pngHasTextChunk(readFileSync(path.join(SNAPSHOT_DIR, name)))).toBe(false);
    }
  });

  it('does not use the clock, random bytes, or a remote host', () => {
    const relative = ['src/lib/client/tui/visual-shots.ts', 'e2e/gallery-visual.test.ts'];
    const needles = [
      'Date.now',
      'new Date',
      'Math.random',
      'randomInt',
      'child_process',
      'http://',
      'https://',
      'console.log',
    ];
    for (const file of relative) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const needle of needles) {
        expect(text, `${file} ${needle}`).not.toContain(needle);
      }
    }
    const e2e = readFileSync(path.join(ROOT, 'e2e/gallery-visual.test.ts'), 'utf8');
    expect(e2e).toContain("const CLIENT_IP = '198.51.100.32'");
    expect(e2e).toContain('toHaveScreenshot(item.file');
    expect(e2e).toContain('visualGalleryPath(item.id)');
    expect(e2e).not.toContain('csrfToken}');
  });
});
