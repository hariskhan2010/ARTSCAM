import { loadFont, type LoadedFont } from '@naqsh/core';
import naskhArabic from '@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff?url';
import naskhLatin from '@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-latin-400-normal.woff?url';
import nastaliqArabic from '@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff?url';
import nastaliqLatin from '@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-latin-400-normal.woff?url';

/**
 * Fonts for the Text tool. Bundled families are split into an Arabic-script
 * file and a Latin file (that is how the font packages ship them); layout
 * falls back from one to the other per character. Fonts the user loads live
 * only in memory: placed text is converted to vectors, so the project never
 * needs the font again.
 */

export interface FontFamily {
  id: string;
  name: string;
  /** Lazily loaded fonts, in fallback order. */
  load: () => Promise<LoadedFont[]>;
}

const cache = new Map<string, Promise<LoadedFont[]>>();

async function fetchFont(url: string, name: string): Promise<LoadedFont> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load font ${name} (${res.status})`);
  return loadFont(new Uint8Array(await res.arrayBuffer()), name);
}

function bundled(id: string, name: string, files: [string, string][]): FontFamily {
  return {
    id,
    name,
    load: () => {
      let p = cache.get(id);
      if (!p) {
        p = Promise.all(files.map(([url, label]) => fetchFont(url, label)));
        cache.set(id, p);
        p.catch(() => cache.delete(id));
      }
      return p;
    },
  };
}

export const BUNDLED_FONTS: FontFamily[] = [
  bundled('naskh', 'Naskh: Arabic, Urdu, Latin', [
    [naskhArabic, 'Noto Naskh Arabic'],
    [naskhLatin, 'Noto Naskh Arabic (Latin)'],
  ]),
  bundled('nastaliq', 'Nastaliq: Urdu calligraphy', [
    [nastaliqArabic, 'Noto Nastaliq Urdu'],
    [nastaliqLatin, 'Noto Nastaliq Urdu (Latin)'],
  ]),
];

/** Registers a font file chosen by the user and returns its family. */
export async function addUserFont(file: File): Promise<FontFamily> {
  const font = await loadFont(new Uint8Array(await file.arrayBuffer()), file.name);
  const id = `user:${file.name}:${file.size}`;
  // User fonts fall back to the bundled Naskh for any characters they lack.
  const family: FontFamily = {
    id,
    name: file.name.replace(/\.(ttf|otf|woff)$/i, ''),
    load: async () => [font, ...(await (BUNDLED_FONTS[0] as FontFamily).load())],
  };
  userFonts.push(family);
  return family;
}

export const userFonts: FontFamily[] = [];

export function allFonts(): FontFamily[] {
  return [...BUNDLED_FONTS, ...userFonts];
}
