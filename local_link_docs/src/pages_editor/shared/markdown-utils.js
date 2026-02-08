import { marked } from 'marked';
import TurndownService from 'turndown';

// Configure Turndown for GFM-like markdown
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

// Configure Marked for consistent rendering
marked.setOptions({
  gfm: true,
  breaks: true
});

/**
 * Converts Markdown to Quill-compatible HTML
 */
export function mdToHtml(md, baseUrl) {
  if (!md) return '';

  const renderer = new marked.Renderer();
  const originalImage = renderer.image;

  // Resolve relative images against Braid server
  renderer.image = (href, title, text) => {
    if (href && href.startsWith('/') && baseUrl) {
      try {
        const origin = new URL(baseUrl).origin;
        href = `${origin}${href}`;
      } catch (e) {}
    }
    return originalImage.call(renderer, href, title, text);
  };

  return marked.parse(md, { renderer });
}

/**
 * Converts Quill HTML back to Markdown for Braid sync
 */
export function htmlToMd(html) {
  if (!html) return '';
  return turndownService.turndown(html);
}
