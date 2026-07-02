export type SeatPosition = {
  index: number;
  x: number;
  y: number;
  angle: number;
};

export function calculateCircularSeats(count: number, radius: number): SeatPosition[] {
  // Calculates evenly spaced seat positions on a circle.
  // x/y are percentage offsets from the center and are later used in CSS.
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
