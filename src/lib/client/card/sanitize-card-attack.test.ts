import { describe, expect, it } from 'vitest';
import { sanitizeCardHtml } from './sanitize-card.js';

// Contract: attack cases for the card HTML allowlist (CWE-79).
// A raw < is allowed only for a cloze span, br, hr, or a media img.
// The img src is /api/media/ plus 64 lower-case hex digits.

const HEX = 'ab'.repeat(32);
const MARKS = ['<span class="cloze">', '</span>', '<br>', '<hr>'];
const MAX_DEPTH = 32;

function assertSafe(html: string): void {
  expect(html.length).toBeLessThanOrEqual(200_000);
  let index = 0;
  while (index < html.length) {
    if (html.charAt(index) !== '<') {
      index += 1;
      continue;
    }
    const rest = html.slice(index);
    const img = /^<img src="\/api\/media\/[0-9a-f]{64}" alt="">/.exec(rest);
    if (img !== null) {
      index += img[0].length;
      continue;
    }
    const mark = MARKS.find((item) => rest.startsWith(item));
    expect(mark, rest.slice(0, 48)).toBeTruthy();
    index += mark?.length ?? 1;
  }
}

function openCount(html: string): number {
  const open = '<span class="cloze">';
  let count = 0;
  let index = 0;
  while (index < html.length) {
    if (html.startsWith(open, index)) {
      count += 1;
      index += open.length;
      continue;
    }
    index += 1;
  }
  return count;
}

const TAGS = [
  '<script>alert(1)</script>',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<ScRiPt>alert(1)</ScRiPt>',
  '<script/src=//evil>',
  '<script\t>alert(1)</script>',
  '<script\n>alert(1)</script>',
  '<scr\u0000ipt>alert(1)</script>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<svg onload="alert(1)"><script>alert(1)</script></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;"></math>',
  '<style>@import "https://evil";</style>',
  '<link rel="stylesheet" href="https://evil">',
  '<meta http-equiv="refresh" content="0;url=https://evil">',
  '<base href="https://evil/">',
  '<form action="https://evil"><input name="x"></form>',
  '<img src=x onerror=alert(1)>',
  '<img src=x srcset="javascript:alert(1)">',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="javascript\t:alert(1)">x</a>',
  '<a href="javascript\n:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<span class="cloze" onclick="alert(1)">x</span>',
  '<span class="cloze" style="background:url(javascript:alert(1))">x</span>',
  "<span class='cloze'>x</span>",
  '<SPAN class="cloze">x</SPAN>',
  '<span\tclass="cloze">x</span>',
  '<br onclick="alert(1)">',
  '<br/>',
  '<BR>',
  '<hr style="x">',
  '<!--<script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<noscript><img src=x onerror=alert(1)></noscript>',
  '<template><script>alert(1)</script></template>',
  '<textarea><script>alert(1)</script></textarea>',
  '<title><script>alert(1)</script></title>',
  '</span><img src=x onerror=alert(1)>',
  '<span class="cloze"></span><img src=x onerror=alert(1)>',
  '<svg><desc><span class="cloze"></span><img src=x onerror=alert(1)></desc></svg>',
  `<span class="cloze">{{media:${HEX}}}</span>`,
  `{{media:${HEX.toUpperCase()}}}`,
  '{{media:../etc/passwd}}',
  `{{media:../${HEX}}}`,
  `{{media:${HEX}../}}`,
  '{{media:zzzz}}',
  `{{media:${'g'.repeat(64)}}}`,
  '<span class="cloze"><!--</span><script>alert(1)</script>-->',
  '＜script＞alert(1)＜/script＞',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '',
];

describe('sanitizeCardHtml attacks', () => {
  it('keeps only the allowlist for hostile markup', () => {
    for (const sample of TAGS) {
      assertSafe(sanitizeCardHtml(sample));
    }
  });

  it('returns an empty string for a non-string', () => {
    expect(sanitizeCardHtml(undefined as unknown as string)).toBe('');
    expect(sanitizeCardHtml(null as unknown as string)).toBe('');
    expect(sanitizeCardHtml(1 as unknown as string)).toBe('');
    expect(sanitizeCardHtml(['<script>alert(1)</script>'] as unknown as string)).toBe('');
  });

  it('escapes cloze spans nested deeper than 32', () => {
    const html = sanitizeCardHtml(`${'<span class="cloze">'.repeat(40)}x${'</span>'.repeat(40)}`);
    assertSafe(html);
    expect(openCount(html)).toBe(MAX_DEPTH);
    expect(html).toContain('&lt;span class="cloze"&gt;');
  });

  it('keeps a shallow cloze and a lower-case media token', () => {
    const nested = sanitizeCardHtml('<span class="cloze"><span class="cloze">x</span></span>');
    expect(openCount(nested)).toBe(2);
    assertSafe(nested);
    const media = sanitizeCardHtml(`{{media:${HEX}}}`);
    expect(media).toBe(`<img src="/api/media/${HEX}" alt="">`);
    assertSafe(media);
  });

  it('stops on a huge input and does not throw', () => {
    expect(sanitizeCardHtml('<'.repeat(200_001)).length).toBe(200_000);
    expect(sanitizeCardHtml('{{media:'.repeat(20_000)).length).toBeLessThanOrEqual(200_000);
    assertSafe(sanitizeCardHtml('<span class="cloze">'.repeat(5_000)));
  });
});
