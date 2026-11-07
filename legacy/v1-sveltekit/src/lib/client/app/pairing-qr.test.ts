import { describe, expect, it } from 'vitest';
import { pairingQrDataUrl } from './pairing-qr.js';

describe('pairingQrDataUrl', () => {
  it('renders an SVG data URL for a pairing payload', () => {
    const url = pairingQrDataUrl(
      JSON.stringify({ v: 1, origin: 'https://srep.test', code: 'ABCD-EFGH' }),
    );
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(url)).toContain('<svg');
  });
});
