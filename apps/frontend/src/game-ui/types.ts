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
