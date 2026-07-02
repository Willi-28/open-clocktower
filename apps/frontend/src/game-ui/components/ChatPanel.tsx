import { useEffect, useRef, useState } from 'react';

import type { ChatMessage } from '../types';

type ChatPanelProps = {
  activeChatTab: string;
  attentionChatTabs: string[];
  chatDraft: string;
  closeChatTab: (playerId: string) => void;
  messages: ChatMessage[];
  onSendMessage: () => void;
  openChatTabs: string[];
  playerName: (playerId: string | undefined) => string;
  setActiveChatTab: (tabId: string) => void;
  setChatDraft: (draft: string) => void;
};

export function ChatPanel({
  activeChatTab,
  attentionChatTabs,
  chatDraft,
  closeChatTab,
  messages,
  onSendMessage,
  openChatTabs,
  playerName,
  setActiveChatTab,
  setChatDraft,
}: ChatPanelProps) {
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (chatLog) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }, [activeChatTab, messages]);

  const privateTabs = openChatTabs.filter((tabId) => tabId !== 'public');
  const activeChatLabel = activeChatTab === 'public' ? 'Public' : playerName(activeChatTab);

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
                onClick={(event) => {
                  event.stopPropagation();
                  closeChatTab(tabId);
                }}
              >
                x
              </small>
            </button>
          );
        })}
        <button className="minimize" aria-label="Minimize chat" onClick={() => setIsOpen(false)} type="button">
          -
        </button>
      </div>

      <div className="chat-log" ref={chatLogRef}>
        {messages.length === 0 ? <p className="helper-text">No messages yet.</p> : null}
        {messages.map((message) => (
          <p className="chat-message" key={message.id}>
            <strong>{playerName(message.fromPlayerId)}:</strong>
            <span>{message.text}</span>
          </p>
        ))}
      </div>

      <div className="chat-input-row">
        <textarea
          aria-label={`Message ${activeChatLabel}`}
          placeholder={activeChatTab === 'public' ? 'Message everyone...' : `Message ${playerName(activeChatTab)}...`}
          rows={2}
          value={chatDraft}
          onChange={(event) => setChatDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSendMessage();
            }
          }}
        />
        <button aria-label="Send message" disabled={!chatDraft.trim()} onClick={onSendMessage} type="button">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M3.2 4.4 21 12 3.2 19.6l1.5-6.2L14 12l-9.3-1.4-1.5-6.2Z" />
          </svg>
        </button>
      </div>
    </section>
  );
}
