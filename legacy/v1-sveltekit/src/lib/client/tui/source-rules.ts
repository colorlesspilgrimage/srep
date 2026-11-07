export function hasUnsafeClientSource(text: string): boolean {
  const htmlNeedle = '{@' + 'html';
  const styleAttr = 'style' + '=';
  const styleDir = 'style' + ':';
  return text.includes(htmlNeedle) || text.includes(styleAttr) || text.includes(styleDir);
}
