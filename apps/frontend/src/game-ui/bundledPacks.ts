/**
 * Character packs available in local development builds.
 *
 * The list is built from `src/packs/*.zip` at build time, so adding a pack is
 * only a matter of dropping the file in. A bundled pack is sent to the room
 * through the same upload the manual ZIP picker uses, which keeps it working on
 * any server without that server needing to know about it.
 */

// Vite resolves each match to an emitted asset URL; the ZIPs are far past the
// inline limit, so they stay separate files instead of entering the JS bundle.
const packUrls = import.meta.glob('@character-packs/*.zip', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export type BundledPack = {
  id: string;
  label: string;
  url: string;
};

/**
 * Turn a pack file name into its label.
 *
 * The file name is the only source: "the-menagerie-v1.17.zip" reads as
 * "The Menagerie v1.17", so renaming the file is how the label is changed.
 * Anything already carrying digits or capitals - versions, initialisms - is
 * left alone rather than title-cased into something wrong.
 */
function packLabel(fileName: string) {
  return fileName
    .replace(/\.zip$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (/[0-9A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export const bundledPacks: BundledPack[] = Object.entries(packUrls)
  .map(([path, url]) => {
    const fileName = path.split('/').pop() ?? path;
    return { id: fileName.replace(/\.zip$/i, ''), label: packLabel(fileName), url };
  })
  .sort((first, second) => first.label.localeCompare(second.label));

/** Fetch one bundled pack as a File, so it can take the normal upload path. */
export async function loadBundledPack(pack: BundledPack): Promise<File> {
  const response = await fetch(pack.url);
  if (!response.ok) {
    throw new Error(`Could not read the bundled pack "${pack.label}".`);
  }
  return new File([await response.blob()], `${pack.id}.zip`, { type: 'application/zip' });
}
