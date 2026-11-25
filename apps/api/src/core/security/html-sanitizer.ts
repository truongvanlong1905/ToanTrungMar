/**
 * Server-side HTML Sanitizer for Untrusted / Rich-Text Executive Reports (Defense in Depth)
 * Strips active tags (<script>, <iframe>, <object>, <embed>, <svg>, <math>, <style>, <form>, etc.),
 * inline event handlers (on*=), dangerous CSS expressions, and javascript:/data:/vbscript: URLs.
 */

const BLOCKED_CONTAINER_TAG_REGEX =
  /<(script|iframe|object|embed|svg|math|style|applet|frameset|frame|form|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

const BLOCKED_VOID_OR_UNCLOSED_TAG_REGEX =
  /<\/?(script|iframe|object|embed|svg|math|style|link|meta|base|form|input|textarea|select|button|option|applet|frame|frameset|audio|video|source|track|canvas|noscript|template)\b[^>]*\/?>/gi;

const INLINE_EVENT_ATTR_REGEX =
  /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi;

const SRCDOC_ATTR_REGEX =
  /\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi;

const DANGEROUS_STYLE_VALUE_REGEX =
  /expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|@import|behavior\s*:|-moz-binding/i;

function isSafeUrlValue(rawUrl: string): boolean {
  const decoded = rawUrl
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/[\u0000-\u0020]+/g, '')
    .trim()
    .toLowerCase();

  if (!decoded) return true;
  if (
    decoded.startsWith('javascript:') ||
    decoded.startsWith('vbscript:') ||
    decoded.startsWith('data:') ||
    decoded.startsWith('file:') ||
    decoded.startsWith('//')
  ) {
    return false;
  }
  return (
    decoded.startsWith('/') ||
    decoded.startsWith('#') ||
    decoded.startsWith('https://') ||
    decoded.startsWith('http://') ||
    decoded.startsWith('mailto:') ||
    decoded.startsWith('tel:')
  );
}

export function sanitizeUntrustedReportHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let cleaned = rawHtml
    .replace(/\0/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Multi-pass strip for nested dangerous container tags
  for (let pass = 0; pass < 3; pass++) {
    const prev = cleaned;
    cleaned = cleaned
      .replace(BLOCKED_CONTAINER_TAG_REGEX, '')
      .replace(BLOCKED_VOID_OR_UNCLOSED_TAG_REGEX, '');
    if (cleaned === prev) break;
  }

  cleaned = cleaned
    .replace(INLINE_EVENT_ATTR_REGEX, '')
    .replace(SRCDOC_ATTR_REGEX, '')
    .replace(
      /\s+(href|src|xlink:href|action|formaction)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      (full, attrName: string, _quoted: string, dq?: string, sq?: string, uq?: string) => {
        const val = dq ?? sq ?? uq ?? '';
        if (!isSafeUrlValue(val)) {
          return ` ${attrName}="#blocked"`;
        }
        const safeVal = val.replace(/"/g, '&quot;');
        return ` ${attrName}="${safeVal}"`;
      },
    )
    .replace(
      /\s+style\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      (_full, _quoted: string, dq?: string, sq?: string, uq?: string) => {
        const val = dq ?? sq ?? uq ?? '';
        if (DANGEROUS_STYLE_VALUE_REGEX.test(val) || /url\s*\(/i.test(val)) {
          return '';
        }
        return ` style="${val.replace(/"/g, '&quot;')}"`;
      },
    );

  return cleaned;
}
