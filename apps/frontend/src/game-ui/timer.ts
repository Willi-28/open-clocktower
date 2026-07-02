/**
 * Timer formatting helper.
 *
 * The timer UI stores durations as seconds, while the controls display the
 * compact MM:SS format used by storytellers during live games.
 */

/** Convert seconds into a zero-padded MM:SS label. */
export function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}
