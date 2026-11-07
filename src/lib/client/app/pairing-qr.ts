import { renderSVG } from 'uqr';

/** SVG data URL for the pairing payload string the iOS app scans. */
export function pairingQrDataUrl(payloadJson: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(payloadJson))}`;
}
