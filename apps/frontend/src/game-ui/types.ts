/**
 * Local UI-only data types.
 *
 * These shapes describe browser-side annotations and chat messages that are
 * rendered by the frontend but are not full backend room models.
 */

export type ReminderToken = {
  id: string;
  tokenId?: string;
  label: string;
  icon?: string | null;
  x: number;
  y: number;
};

export type ChatMessage = {
  id: string;
  fromPlayerId: string;
  toPlayerId: string | null;
  text: string;
};
