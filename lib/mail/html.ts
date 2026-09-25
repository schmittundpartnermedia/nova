const TRACKING = /<(img|link)\b[^>]*(?:width\s*=\s*["']?1|height\s*=\s*["']?1|tracking|pixel|open\?|beacon)[^>]*>/gi;

export function htmlToNormalizedText(html: string): string {
  let source = html;
  source = source.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
  source = source.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  source = source.replace(/<head[\s\S]*?>[\s\S]*?<\/head>/gi, " ");
  source = source.replace(TRACKING, " ");
  source = source.replace(/<br\s*\/?>/gi, "\n");
  source = source.replace(/<\/p>/gi, "\n");
  source = source.replace(/<[^>]+>/g, " ");
  source = decodeEntities(source);
  return source
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
