/**
 * Chat emoji shortcode helpers.
 *
 * Message payloads stay plain text; rendering converts both Discord-style
 * `:name:` shortcodes and known emoji characters into emoji segments in a
 * small, bounded pass.
 */

export type EmojiDefinition = {
  shortcode: string;
  emoji: string;
  category: 'Smileys' | 'Gestures' | 'Symbols' | 'Objects';
  keywords: string[];
  aliases?: string[];
};

export type EmojiSegment =
  | { type: 'text'; value: string }
  | { type: 'emoji'; emoji: string; shortcode: string };

const twemojiBaseUrl = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg';

export const emojiDefinitions: EmojiDefinition[] = [
  { shortcode: 'grinning', emoji: '😀', category: 'Smileys', keywords: ['happy', 'face'] },
  { shortcode: 'smiley', emoji: '😃', category: 'Smileys', keywords: ['happy', 'face'] },
  { shortcode: 'smile', emoji: '😄', category: 'Smileys', keywords: ['happy', 'face'] },
  { shortcode: 'grin', emoji: '😁', category: 'Smileys', keywords: ['happy', 'face'] },
  { shortcode: 'laughing', emoji: '😆', category: 'Smileys', keywords: ['lol', 'happy'], aliases: ['satisfied'] },
  { shortcode: 'sweat_smile', emoji: '😅', category: 'Smileys', keywords: ['nervous', 'happy'] },
  { shortcode: 'joy', emoji: '😂', category: 'Smileys', keywords: ['lol', 'tears'] },
  { shortcode: 'rofl', emoji: '🤣', category: 'Smileys', keywords: ['lol', 'laugh'], aliases: ['rolling_on_the_floor_laughing'] },
  { shortcode: 'slight_smile', emoji: '🙂', category: 'Smileys', keywords: ['happy', 'soft'], aliases: ['slightly_smiling_face'] },
  { shortcode: 'upside_down', emoji: '🙃', category: 'Smileys', keywords: ['silly', 'sarcasm'], aliases: ['upside_down_face'] },
  { shortcode: 'wink', emoji: '😉', category: 'Smileys', keywords: ['flirt', 'joke'] },
  { shortcode: 'blush', emoji: '😊', category: 'Smileys', keywords: ['happy', 'shy'] },
  { shortcode: 'innocent', emoji: '😇', category: 'Smileys', keywords: ['angel', 'pure'] },
  { shortcode: 'heart_eyes', emoji: '😍', category: 'Smileys', keywords: ['love', 'crush'] },
  { shortcode: 'kissing_heart', emoji: '😘', category: 'Smileys', keywords: ['kiss', 'love'] },
  { shortcode: 'kissing', emoji: '😗', category: 'Smileys', keywords: ['kiss'] },
  { shortcode: 'kissing_smiling_eyes', emoji: '😙', category: 'Smileys', keywords: ['kiss', 'happy'] },
  { shortcode: 'kissing_closed_eyes', emoji: '😚', category: 'Smileys', keywords: ['kiss', 'happy'] },
  { shortcode: 'yum', emoji: '😋', category: 'Smileys', keywords: ['food', 'tongue'] },
  { shortcode: 'stuck_out_tongue', emoji: '😛', category: 'Smileys', keywords: ['tongue', 'playful'] },
  { shortcode: 'stuck_out_tongue_winking_eye', emoji: '😜', category: 'Smileys', keywords: ['tongue', 'wink'] },
  { shortcode: 'stuck_out_tongue_closed_eyes', emoji: '😝', category: 'Smileys', keywords: ['tongue', 'playful'] },
  { shortcode: 'zany_face', emoji: '🤪', category: 'Smileys', keywords: ['silly', 'wild'], aliases: ['crazy_face'] },
  { shortcode: 'sunglasses', emoji: '😎', category: 'Smileys', keywords: ['cool', 'sun'] },
  { shortcode: 'nerd', emoji: '🤓', category: 'Smileys', keywords: ['smart', 'glasses'], aliases: ['nerd_face'] },
  { shortcode: 'partying_face', emoji: '🥳', category: 'Smileys', keywords: ['party', 'celebrate'] },
  { shortcode: 'smirk', emoji: '😏', category: 'Smileys', keywords: ['smug', 'face'] },
  { shortcode: 'neutral_face', emoji: '😐', category: 'Smileys', keywords: ['meh', 'flat'] },
  { shortcode: 'expressionless', emoji: '😑', category: 'Smileys', keywords: ['meh', 'blank'] },
  { shortcode: 'unamused', emoji: '😒', category: 'Smileys', keywords: ['annoyed', 'side eye'] },
  { shortcode: 'rolling_eyes', emoji: '🙄', category: 'Smileys', keywords: ['annoyed', 'eyeroll'], aliases: ['face_with_rolling_eyes'] },
  { shortcode: 'thinking', emoji: '🤔', category: 'Smileys', keywords: ['hmm', 'question'], aliases: ['thinking_face'] },
  { shortcode: 'face_with_raised_eyebrow', emoji: '🤨', category: 'Smileys', keywords: ['doubt', 'sus'] },
  { shortcode: 'pleading_face', emoji: '🥺', category: 'Smileys', keywords: ['please', 'sad'] },
  { shortcode: 'shushing_face', emoji: '🤫', category: 'Smileys', keywords: ['quiet', 'secret'] },
  { shortcode: 'lying_face', emoji: '🤥', category: 'Smileys', keywords: ['lie', 'pinocchio'] },
  { shortcode: 'relieved', emoji: '😌', category: 'Smileys', keywords: ['calm', 'peace'] },
  { shortcode: 'pensive', emoji: '😔', category: 'Smileys', keywords: ['sad', 'down'] },
  { shortcode: 'sleepy', emoji: '😪', category: 'Smileys', keywords: ['tired', 'sleep'] },
  { shortcode: 'sob', emoji: '😭', category: 'Smileys', keywords: ['cry', 'tears'] },
  { shortcode: 'cry', emoji: '😢', category: 'Smileys', keywords: ['sad', 'tear'] },
  { shortcode: 'angry', emoji: '😠', category: 'Smileys', keywords: ['mad', 'annoyed'] },
  { shortcode: 'rage', emoji: '😡', category: 'Smileys', keywords: ['mad', 'furious'] },
  { shortcode: 'flushed', emoji: '😳', category: 'Smileys', keywords: ['shock', 'embarrassed'] },
  { shortcode: 'scream', emoji: '😱', category: 'Smileys', keywords: ['fear', 'shock'] },
  { shortcode: 'fearful', emoji: '😨', category: 'Smileys', keywords: ['fear', 'scared'] },
  { shortcode: 'cold_sweat', emoji: '😰', category: 'Smileys', keywords: ['fear', 'nervous'] },
  { shortcode: 'confused', emoji: '😕', category: 'Smileys', keywords: ['huh', 'question'] },
  { shortcode: 'woozy_face', emoji: '🥴', category: 'Smileys', keywords: ['dizzy', 'drunk'] },
  { shortcode: 'dizzy_face', emoji: '😵', category: 'Smileys', keywords: ['dizzy', 'dead'] },
  { shortcode: 'skull', emoji: '💀', category: 'Smileys', keywords: ['dead', 'death'] },
  { shortcode: 'skull_crossbones', emoji: '☠️', category: 'Smileys', keywords: ['death', 'danger'], aliases: ['skull_and_crossbones'] },
  { shortcode: 'clown', emoji: '🤡', category: 'Smileys', keywords: ['joke', 'silly'], aliases: ['clown_face'] },
  { shortcode: 'poop', emoji: '💩', category: 'Smileys', keywords: ['bad', 'mess'], aliases: ['hankey', 'shit'] },
  { shortcode: 'wave', emoji: '👋', category: 'Gestures', keywords: ['hello', 'bye'] },
  { shortcode: 'raised_hand', emoji: '✋', category: 'Gestures', keywords: ['hand', 'stop'], aliases: ['hand'] },
  { shortcode: 'ok_hand', emoji: '👌', category: 'Gestures', keywords: ['ok', 'perfect'] },
  { shortcode: 'pinching_hand', emoji: '🤏', category: 'Gestures', keywords: ['small', 'pinch'] },
  { shortcode: 'v', emoji: '✌️', category: 'Gestures', keywords: ['peace', 'victory'] },
  { shortcode: 'crossed_fingers', emoji: '🤞', category: 'Gestures', keywords: ['luck', 'hope'] },
  { shortcode: 'thumbsup', emoji: '👍', category: 'Gestures', keywords: ['yes', 'approve'], aliases: ['+1'] },
  { shortcode: 'thumbsdown', emoji: '👎', category: 'Gestures', keywords: ['no', 'disapprove'], aliases: ['-1'] },
  { shortcode: 'clap', emoji: '👏', category: 'Gestures', keywords: ['applause', 'good'] },
  { shortcode: 'pray', emoji: '🙏', category: 'Gestures', keywords: ['please', 'thanks'] },
  { shortcode: 'eyes', emoji: '👀', category: 'Gestures', keywords: ['look', 'watch'] },
  { shortcode: 'muscle', emoji: '💪', category: 'Gestures', keywords: ['strong', 'flex'] },
  { shortcode: 'point_up', emoji: '☝️', category: 'Gestures', keywords: ['up', 'one'] },
  { shortcode: 'point_down', emoji: '👇', category: 'Gestures', keywords: ['down'] },
  { shortcode: 'point_left', emoji: '👈', category: 'Gestures', keywords: ['left'] },
  { shortcode: 'point_right', emoji: '👉', category: 'Gestures', keywords: ['right'] },
  { shortcode: 'heart', emoji: '❤️', category: 'Symbols', keywords: ['love', 'red'], aliases: ['red_heart'] },
  { shortcode: 'orange_heart', emoji: '🧡', category: 'Symbols', keywords: ['love'] },
  { shortcode: 'yellow_heart', emoji: '💛', category: 'Symbols', keywords: ['love'] },
  { shortcode: 'green_heart', emoji: '💚', category: 'Symbols', keywords: ['love'] },
  { shortcode: 'blue_heart', emoji: '💙', category: 'Symbols', keywords: ['love'] },
  { shortcode: 'purple_heart', emoji: '💜', category: 'Symbols', keywords: ['love'] },
  { shortcode: 'black_heart', emoji: '🖤', category: 'Symbols', keywords: ['love'] },
  { shortcode: 'broken_heart', emoji: '💔', category: 'Symbols', keywords: ['sad', 'love'] },
  { shortcode: 'sparkles', emoji: '✨', category: 'Symbols', keywords: ['magic', 'shine'] },
  { shortcode: 'star', emoji: '⭐', category: 'Symbols', keywords: ['favorite', 'shine'] },
  { shortcode: 'fire', emoji: '🔥', category: 'Symbols', keywords: ['hot', 'lit'] },
  { shortcode: 'boom', emoji: '💥', category: 'Symbols', keywords: ['explode', 'impact'], aliases: ['collision'] },
  { shortcode: 'dizzy', emoji: '💫', category: 'Symbols', keywords: ['star', 'spin'] },
  { shortcode: 'warning', emoji: '⚠️', category: 'Symbols', keywords: ['alert', 'danger'] },
  { shortcode: 'question', emoji: '❓', category: 'Symbols', keywords: ['ask', 'unknown'] },
  { shortcode: 'grey_question', emoji: '❔', category: 'Symbols', keywords: ['ask', 'unknown'] },
  { shortcode: 'exclamation', emoji: '❗', category: 'Symbols', keywords: ['alert', 'important'], aliases: ['heavy_exclamation_mark'] },
  { shortcode: 'grey_exclamation', emoji: '❕', category: 'Symbols', keywords: ['alert', 'important'] },
  { shortcode: 'white_check_mark', emoji: '✅', category: 'Symbols', keywords: ['yes', 'done'] },
  { shortcode: 'x', emoji: '❌', category: 'Symbols', keywords: ['no', 'wrong'], aliases: ['cross_mark'] },
  { shortcode: 'negative_squared_cross_mark', emoji: '❎', category: 'Symbols', keywords: ['no', 'wrong'] },
  { shortcode: 'zzz', emoji: '💤', category: 'Symbols', keywords: ['sleep', 'night'] },
  { shortcode: 'speech_balloon', emoji: '💬', category: 'Symbols', keywords: ['chat', 'talk'] },
  { shortcode: 'game_die', emoji: '🎲', category: 'Objects', keywords: ['game', 'random'] },
  { shortcode: 'crystal_ball', emoji: '🔮', category: 'Objects', keywords: ['magic', 'fortune'] },
  { shortcode: 'hourglass', emoji: '⌛', category: 'Objects', keywords: ['time', 'timer'] },
  { shortcode: 'hourglass_flowing_sand', emoji: '⏳', category: 'Objects', keywords: ['time', 'timer'] },
  { shortcode: 'alarm_clock', emoji: '⏰', category: 'Objects', keywords: ['time', 'timer'] },
  { shortcode: 'bell', emoji: '🔔', category: 'Objects', keywords: ['ring', 'alarm'] },
  { shortcode: 'dagger', emoji: '🗡️', category: 'Objects', keywords: ['kill', 'knife'], aliases: ['dagger_knife'] },
  { shortcode: 'shield', emoji: '🛡️', category: 'Objects', keywords: ['protect', 'guard'] },
  { shortcode: 'beer', emoji: '🍺', category: 'Objects', keywords: ['drink', 'drunk'] },
  { shortcode: 'beers', emoji: '🍻', category: 'Objects', keywords: ['drink', 'cheers'] },
  { shortcode: 'wine_glass', emoji: '🍷', category: 'Objects', keywords: ['drink'] },
];

const emojiByShortcode = new Map<string, EmojiDefinition>();
const emojiByCharacter = new Map<string, EmojiDefinition>();
for (const definition of emojiDefinitions) {
  emojiByShortcode.set(definition.shortcode, definition);
  emojiByCharacter.set(definition.emoji, definition);
  for (const alias of definition.aliases ?? []) {
    emojiByShortcode.set(alias, definition);
  }
}
// Matches either a `:name:` shortcode or one of the known emoji literals
// (longest first, so variation-selector sequences win over their base char).
const emojiTokenPattern = new RegExp(
  `:([a-z0-9_+\\-]+):|${[...emojiByCharacter.keys()].sort((a, b) => b.length - a.length).join('|')}`,
  'gi',
);
const defaultEmojiResultLimit = 48;

/** Return the matching emoji for a Discord-style shortcode without colons. */
export function emojiForShortcode(shortcode: string) {
  return emojiByShortcode.get(shortcode.toLowerCase());
}

/** Search the bounded emoji list by shortcode or keyword for the picker. */
export function searchEmojis(query: string, limit = defaultEmojiResultLimit) {
  const normalizedQuery = query.trim().replace(/^:+|:+$/g, '').toLowerCase();
  if (!normalizedQuery) {
    return emojiDefinitions.slice(0, limit);
  }
  return emojiDefinitions
    .filter((definition) =>
      definition.shortcode.includes(normalizedQuery) ||
      (definition.aliases ?? []).some((alias) => alias.includes(normalizedQuery)) ||
      definition.keywords.some((keyword) => keyword.includes(normalizedQuery)),
    )
    .slice(0, limit);
}

/** Split a chat message into safe text and emoji render segments. */
export function tokenizeEmojiShortcodes(text: string): EmojiSegment[] {
  const segments: EmojiSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(emojiTokenPattern)) {
    const matchIndex = match.index ?? 0;
    const definition = match[1] ? emojiForShortcode(match[1]) : emojiByCharacter.get(match[0]);
    if (!definition) {
      continue;
    }
    if (matchIndex > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, matchIndex) });
    }
    segments.push({ type: 'emoji', emoji: definition.emoji, shortcode: definition.shortcode });
    lastIndex = matchIndex + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

/** Return whether a message contains only shortcode-rendered emoji and whitespace. */
export function isEmojiOnlyMessage(text: string) {
  const segments = tokenizeEmojiShortcodes(text);
  return segments.some((segment) => segment.type === 'emoji') &&
    segments.every((segment) => segment.type === 'emoji' || segment.value.trim().length === 0);
}

/** Build the Twemoji SVG asset URL that matches Discord-style emoji rendering. */
export function twemojiUrl(emoji: string) {
  const codepoints = Array.from(emoji)
    .map((character) => character.codePointAt(0))
    .filter((codepoint): codepoint is number => Boolean(codepoint) && codepoint !== 0xfe0e && codepoint !== 0xfe0f)
    .map((codepoint) => codepoint.toString(16))
    .join('-');
  return `${twemojiBaseUrl}/${codepoints}.svg`;
}

/** Insert the picked emoji character at the current textarea selection. */
export function insertEmoji(draft: string, shortcode: string, selectionStart: number, selectionEnd: number) {
  const insertion = emojiForShortcode(shortcode)?.emoji ?? `:${shortcode}:`;
  const prefix = draft.slice(0, selectionStart);
  const suffix = draft.slice(selectionEnd);
  return {
    nextDraft: `${prefix}${insertion}${suffix}`,
    nextCursor: prefix.length + insertion.length,
  };
}
