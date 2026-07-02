/**
 * Circular table layout helper.
 *
 * Seat positions are generated as percentage offsets from the center so the
 * same math can scale across desktop, laptop, and mobile table sizes.
 */

export type SeatPosition = {
  index: number;
  x: number;
  y: number;
  angle: number;
};

/** Calculate evenly spaced seat positions on a circle. */
export function calculateCircularSeats(count: number, radius: number): SeatPosition[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    return {
      index,
      angle,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}
