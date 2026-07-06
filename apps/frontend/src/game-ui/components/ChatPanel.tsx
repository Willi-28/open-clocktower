/**
 * Text chat panel.
 *
 * This component renders public/private chat tabs, groups consecutive messages
 * from the same sender into bubbles, keeps the log pinned to the newest message
 * (unless the user scrolled up), and sends messages from the composer. The
 * emoji picker inserts the actual emoji character at the cursor; typed
 * `:name:` shortcodes keep working too.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';

import {
  emojiDefinitions,
  insertEmoji,
  isEmojiOnlyMessage,
  searchEmojis,
  tokenizeEmojiShortcodes,
} from '../emojis';
import type { EmojiDefinition } from '../emojis';
import { twemojiUrl } from '../twemoji';
import type { ChatMessage } from '../types';

type ChatPanelProps = {
  activeChatTab: string;
  attentionChatTabs: string[];
  chatDraft: string;
  closeChatTab: (playerId: string) => void;
  currentPlayerId: string;
  messages: ChatMessage[];
  onSendMessage: () => void;
  openChatTabs: string[];
  playerName: (playerId: string | undefined) => string;
  setActiveChatTab: (tabId: string) => void;
  setChatDraft: (draft: string) => void;
};

type ChatMessageTextProps = {
  text: string;
};

// Consecutive messages from one sender merge into a group within this window.
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Render Discord-style `:name:` shortcodes as emoji without using HTML injection. */
const ChatMessageText = memo(function ChatMessageText({ text }: ChatMessageTextProps) {
  const segments = useMemo(() => tokenizeEmojiShortcodes(text), [text]);
  const isEmojiOnly = useMemo(() => isEmojiOnlyMessage(text), [text]);
  return (
    <span className={isEmojiOnly ? 'chat-message-text emoji-only-message' : 'chat-message-text'}>
      {segments.map((segment, index) =>
        segment.type === 'emoji' ? (
          <img
            alt={segment.emoji}
            className="chat-emoji"
            draggable={false}
            key={`${segment.shortcode}-${index}`}
            loading="lazy"
            src={twemojiUrl(segment.emoji)}
            title={`:${segment.shortcode}:`}
          />
        ) : (
          <span key={`text-${index}`}>{segment.value}</span>
        ),
      )}
    </span>
  );
});

/** Format a message timestamp as a short local wall-clock time. */
function formatMessageTime(at?: number) {
  if (at === undefined) {
    return '';
  }
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Merge consecutive messages from the same sender into renderable groups. */
function groupMessages(messages: ChatMessage[]) {
  const groups: Array<{ id: string; fromPlayerId: string; at?: number; messages: ChatMessage[] }> = [];
  for (const message of messages) {
    const lastGroup = groups[groups.length - 1];
    const lastMessage = lastGroup?.messages[lastGroup.messages.length - 1];
    const isSameSender = lastGroup?.fromPlayerId === message.fromPlayerId;
    const isWithinWindow =
      lastMessage?.at === undefined ||
      message.at === undefined ||
      message.at - lastMessage.at < MESSAGE_GROUP_WINDOW_MS;
    if (lastGroup && isSameSender && isWithinWindow) {
      lastGroup.messages.push(message);
    } else {
      groups.push({ id: message.id, fromPlayerId: message.fromPlayerId, at: message.at, messages: [message] });
    }
  }
  return groups;
}

type EmojiPickerProps = {
  onClose: () => void;
  onSelect: (shortcode: string) => void;
};

/** Emoji-only picker popover with search and category sections. */
function EmojiPicker({ onClose, onSelect }: EmojiPickerProps) {
  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking anywhere outside the popover (the toggle button stops
  // propagation itself so it can flip the open state instead).
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (panelRef.current && event.target instanceof Node && !panelRef.current.contains(event.target)) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  const query = search.trim();
  const results = useMemo(() => (query ? searchEmojis(query, 96) : []), [query]);
  const categories = useMemo(() => {
    const sections: Array<{ name: EmojiDefinition['category']; emojis: EmojiDefinition[] }> = [];
    for (const definition of emojiDefinitions) {
      const section = sections.find((candidate) => candidate.name === definition.category);
      if (section) {
        section.emojis.push(definition);
      } else {
        sections.push({ name: definition.category, emojis: [definition] });
      }
    }
    return sections;
  }, []);

  function renderEmojiButton(emoji: EmojiDefinition) {
    return (
      <button
        aria-label={emoji.shortcode.replaceAll('_', ' ')}
        key={emoji.shortcode}
        onClick={() => onSelect(emoji.shortcode)}
        title={`:${emoji.shortcode}:`}
        type="button"
      >
        <img alt={emoji.emoji} draggable={false} loading="lazy" src={twemojiUrl(emoji.emoji)} />
      </button>
    );
  }

  return (
    <div className="emoji-picker-panel" ref={panelRef}>
      <input
        aria-label="Search emoji"
        autoFocus
        className="emoji-picker-search"
        placeholder="Search emoji…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
          }
        }}
      />
      <div className="emoji-picker-scroll">
        {query ? (
          <div className="emoji-picker-grid">
            {results.map(renderEmojiButton)}
            {results.length === 0 ? <p>No emoji found.</p> : null}
          </div>
        ) : (
          categories.map((section) => (
            <div key={section.name}>
              <h4 className="emoji-picker-category">{section.name}</h4>
              <div className="emoji-picker-grid">{section.emojis.map(renderEmojiButton)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Render the docked text chat with public and private tabs. */
export function ChatPanel({
  activeChatTab,
  attentionChatTabs,
  chatDraft,
  closeChatTab,
  currentPlayerId,
  messages,
  onSendMessage,
  openChatTabs,
  playerName,
  setActiveChatTab,
  setChatDraft,
}: ChatPanelProps) {
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isPinnedToBottomRef = useRef(true);
  const [isOpen, setIsOpen] = useState(true);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  // Follow new messages only while the user is at (or near) the bottom, so
  // scrolling up to read history is never yanked away. Tab switches reset.
  useEffect(() => {
    isPinnedToBottomRef.current = true;
  }, [activeChatTab]);
  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (chatLog && isPinnedToBottomRef.current) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }, [activeChatTab, messages]);

  // Grow the composer with its content up to a few lines.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 108)}px`;
    }
  }, [chatDraft, isOpen]);

  const privateTabs = openChatTabs.filter((tabId) => tabId !== 'public');
  const activeChatLabel = activeChatTab === 'public' ? 'Public' : playerName(activeChatTab);
  const messageGroups = useMemo(() => groupMessages(messages), [messages]);

  /** Insert one emoji character where the user is currently typing. */
  function selectEmoji(shortcode: string) {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? chatDraft.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const { nextCursor, nextDraft } = insertEmoji(chatDraft, shortcode, selectionStart, selectionEnd);
    setChatDraft(nextDraft);
    // The picker stays open so several emoji can be picked in a row; it closes
    // via the toggle button, Escape, or clicking anywhere outside.
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  if (!isOpen) {
    return (
      <section className="chat-panel chat-panel-closed">
        <button className="chat-panel-open-button" onClick={() => setIsOpen(true)} type="button">
          <span>Text Chat</span>
        </button>
      </section>
    );
  }

  return (
    <section className="chat-panel">
      <div className="chat-simple-targets">
        <button className={activeChatTab === 'public' ? 'active' : ''} onClick={() => setActiveChatTab('public')} type="button">
          <span>Public</span>
        </button>
        {privateTabs.map((tabId) => {
          const isActive = activeChatTab === tabId;
          const needsAttention = attentionChatTabs.includes(tabId);
          return (
            <button
              className={[isActive ? 'active' : '', needsAttention ? 'chat-tab-attention' : ''].filter(Boolean).join(' ')}
              key={tabId}
              onClick={() => setActiveChatTab(tabId)}
              type="button"
            >
              <span>{playerName(tabId)}</span>
              <small
                aria-label={`Close chat with ${playerName(tabId)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeChatTab(tabId);
                }}
                role="button"
              >
                ×
              </small>
            </button>
          );
        })}
        <button className="minimize" aria-label="Minimize chat" onClick={() => setIsOpen(false)} type="button">
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
            viewBox="0 0 24 24"
          >
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>

      <div
        className="chat-log"
        ref={chatLogRef}
        onScroll={(event) => {
          const chatLog = event.currentTarget;
          isPinnedToBottomRef.current = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 60;
        }}
      >
        {messages.length === 0 ? (
          <p className="chat-empty-state">
            No messages in {activeChatLabel} yet.
            <br />
            Say hello!
          </p>
        ) : null}
        {messageGroups.map((group) => {
          const isOwn = group.fromPlayerId === currentPlayerId;
          return (
            <div className={isOwn ? 'chat-group own' : 'chat-group'} key={group.id}>
              <header className="chat-group-header">
                <strong>{isOwn ? 'You' : playerName(group.fromPlayerId)}</strong>
                <time>{formatMessageTime(group.at)}</time>
              </header>
              {group.messages.map((message) => (
                <div className="chat-bubble" key={message.id}>
                  <ChatMessageText text={message.text} />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="chat-input-row">
        {isEmojiPickerOpen ? (
          <EmojiPicker
            onClose={() => setIsEmojiPickerOpen(false)}
            onSelect={selectEmoji}
          />
        ) : null}
        <button
          aria-label="Emoji picker"
          className={isEmojiPickerOpen ? 'chat-emoji-button active' : 'chat-emoji-button'}
          onPointerDown={(event) => {
            // Handled on pointerdown so the picker's outside-click close does
            // not race the toggle; stopPropagation keeps it a pure toggle.
            event.stopPropagation();
            event.preventDefault();
            setIsEmojiPickerOpen((current) => !current);
          }}
          type="button"
        >
          <span aria-hidden="true">☺</span>
        </button>
        <textarea
          aria-label={`Message ${activeChatLabel}`}
          placeholder={activeChatTab === 'public' ? 'Message everyone…' : `Message ${playerName(activeChatTab)}…`}
          ref={textareaRef}
          rows={1}
          value={chatDraft}
          onChange={(event) => setChatDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSendMessage();
            }
            if (event.key === 'Escape' && isEmojiPickerOpen) {
              setIsEmojiPickerOpen(false);
            }
          }}
        />
        <button className="chat-send-button" aria-label="Send message" disabled={!chatDraft.trim()} onClick={onSendMessage} type="button">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M3.2 4.4 21 12 3.2 19.6l1.5-6.2L14 12l-9.3-1.4-1.5-6.2Z" />
          </svg>
        </button>
      </div>
    </section>
  );
}
