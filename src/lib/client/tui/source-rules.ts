// Contract: find raw HTML and an inline style in source text.
// A style directive also writes an inline style. CSP blocks that style.

export function hasUnsafeClientSource(text: string): boolean {
  const htmlNeedle = '{@' + 'html';
  const styleAttr = 'style' + '=';
  const styleDir = 'style' + ':';
  return text.includes(htmlNeedle) || text.includes(styleAttr) || text.includes(styleDir);
}
