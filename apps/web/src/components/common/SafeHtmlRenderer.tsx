'use client';

import React, { useEffect, useRef } from 'react';

const ALLOWED_TAGS = new Set([
  'div',
  'p',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'blockquote',
  'pre',
  'code',
  'a',
  'section',
  'article',
  'header',
  'footer',
  'sup',
  'sub',
  'small',
]);

const ALLOWED_ATTRS = new Set([
  'class',
  'href',
  'target',
  'rel',
  'colspan',
  'rowspan',
  'scope',
  'title',
  'align',
]);

function isSafeClientHref(rawUrl: string): boolean {
  const normalized = rawUrl.replace(/[\u0000-\u0020]+/g, '').trim().toLowerCase();
  if (!normalized) return true;
  if (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('//')
  ) {
    return false;
  }
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('#') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:')
  );
}

export function cleanUntrustedHtmlClient(rawHtml: string): string {
  if (!rawHtml) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return rawHtml
      .replace(/<(script|iframe|object|embed|svg|math|style|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '#blocked:');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  const sanitizeNode = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          node.removeChild(el);
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (!ALLOWED_ATTRS.has(name)) {
            el.removeAttribute(attr.name);
            continue;
          }
          if (name === 'href' && !isSafeClientHref(attr.value)) {
            el.setAttribute('href', '#blocked');
          }
        }
        if (tag === 'a') {
          el.setAttribute('rel', 'noopener noreferrer');
        }
        sanitizeNode(el);
      }
    }
  };

  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

export interface SafeHtmlRendererProps {
  html: string;
  className?: string;
}

export function SafeHtmlRenderer({ html, className }: SafeHtmlRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cleaned = cleanUntrustedHtmlClient(html || '');

    const maybeSetHtml = (el as HTMLElement & { setHTML?: (input: string) => void }).setHTML;
    if (typeof maybeSetHtml === 'function') {
      maybeSetHtml.call(el, cleaned);
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleaned, 'text/html');
    el.replaceChildren(...Array.from(doc.body.childNodes));
  }, [html]);

  return <div ref={containerRef} className={className} />;
}
