/**
 * Bundled Twemoji assets.
 *
 * Every emoji in the bounded chat list ships as a local fingerprinted SVG, so
 * rendering never depends on an external CDN (and works offline). This lives
 * apart from emojis.ts so that module stays pure for the Node unit tests.
 */

import { emojiCodepoints } from './emojis';

const twemojiAssets = import.meta.glob('../assets/twemoji/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

/** Return the bundled SVG URL for one emoji character. */
export function twemojiUrl(emoji: string) {
  return twemojiAssets[`../assets/twemoji/${emojiCodepoints(emoji)}.svg`] ?? '';
}
