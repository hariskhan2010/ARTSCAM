/**
 * Minimal XML reader for SVG import. Core is DOM-free (CLAUDE.md), so this
 * handles just what SVG files need: elements, attributes, text, comments,
 * CDATA, processing instructions and a DOCTYPE (skipped). Entities: the five
 * predefined ones plus numeric character references.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const NAME = /[A-Za-z_:][-\w:.]*/y;
const ATTR = /\s*([A-Za-z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/** Parses an XML document and returns its root element. */
export function parseXml(source: string): XmlElement {
  let i = 0;
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];

  const skipTo = (end: string, what: string) => {
    const j = source.indexOf(end, i);
    if (j < 0) throw new XmlError(`Unclosed ${what}`);
    const body = source.slice(i, j);
    i = j + end.length;
    return body;
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const top = stack.at(-1) as XmlElement;
    if (lt < 0) {
      top.text += decodeEntities(source.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(source.slice(i, lt));
    i = lt;
    if (source.startsWith('<!--', i)) {
      i += 4;
      skipTo('-->', 'comment');
    } else if (source.startsWith('<![CDATA[', i)) {
      i += 9;
      top.text += skipTo(']]>', 'CDATA');
    } else if (source.startsWith('<?', i)) {
      i += 2;
      skipTo('?>', 'processing instruction');
    } else if (source.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [...].
      let depth = 0;
      for (i += 2; i < source.length; i++) {
        const ch = source[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i++;
    } else if (source.startsWith('</', i)) {
      i += 2;
      NAME.lastIndex = i;
      const m = NAME.exec(source);
      if (!m) throw new XmlError('Bad closing tag');
      i = NAME.lastIndex;
      skipTo('>', 'closing tag');
      const open = stack.pop();
      if (!open || open === root || open.name !== m[0]) {
        throw new XmlError(`Mismatched closing tag </${m[0]}>`);
      }
    } else {
      i += 1;
      NAME.lastIndex = i;
      const m = NAME.exec(source);
      if (!m) throw new XmlError(`Bad tag at offset ${lt}`);
      i = NAME.lastIndex;
      const el: XmlElement = { name: m[0], attrs: {}, children: [], text: '' };
      for (;;) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(source);
        if (!a) break;
        el.attrs[a[1] as string] = decodeEntities(a[3] ?? a[4] ?? '');
        i = ATTR.lastIndex;
      }
      while (/\s/.test(source[i] ?? '')) i++;
      top.children.push(el);
      if (source.startsWith('/>', i)) {
        i += 2;
      } else if (source[i] === '>') {
        i += 1;
        stack.push(el);
      } else {
        throw new XmlError(`Malformed tag <${el.name}> at offset ${lt}`);
      }
    }
  }
  if (stack.length > 1)
    throw new XmlError(`Unclosed element <${(stack.at(-1) as XmlElement).name}>`);
  const first = root.children[0];
  if (!first) throw new XmlError('No root element');
  return first;
}
