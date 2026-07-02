/**
 * Text chat state hook.
 *
 * The hook keeps chat drafts, open tabs, unread attention markers, and room
 * resets together so the chat panel can stay mostly presentational.
 */

import { useEffect, useMemo, useState } from 'react';

import type { ChatMessage } from './types';

type UseChatStateOptions = {
  allowedPrivateChatIds: Set<string>;
  allowedPrivateChatKey: string;
  currentPlayerId: string;
  roomId: string;
};

/** Manage public/private chat tabs and visible messages for one room. */
export function useChatState({ allowedPrivateChatIds, allowedPrivateChatKey, currentPlayerId, roomId }: UseChatStateOptions) {
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [openChatTabs, setOpenChatTabs] = useState<string[]>(['public']);
  const [activeChatTab, setActiveChatTab] = useState('public');
  const [attentionChatTabs, setAttentionChatTabs] = useState<string[]>([]);

  useEffect(() => {
    setChatDraft('');
    setChatMessages([]);
    setOpenChatTabs(['public']);
    setActiveChatTab('public');
    setAttentionChatTabs([]);
  }, [roomId]);

  useEffect(() => {
    setOpenChatTabs((current) => {
      const nextTabs = current.filter((tabId) => tabId === 'public' || allowedPrivateChatIds.has(tabId));
      return nextTabs.includes('public') ? nextTabs : ['public', ...nextTabs];
    });
    if (activeChatTab !== 'public' && !allowedPrivateChatIds.has(activeChatTab)) {
      setActiveChatTab('public');
    }
  }, [activeChatTab, allowedPrivateChatIds, allowedPrivateChatKey]);

  const visibleChatMessages = useMemo(
    () =>
      chatMessages.filter((message) => {
        if (activeChatTab === 'public') {
          return message.toPlayerId === null;
        }
        return (
          message.toPlayerId === activeChatTab ||
          (message.fromPlayerId === activeChatTab && message.toPlayerId === currentPlayerId)
        );
      }),
    [activeChatTab, chatMessages, currentPlayerId],
  );

  /** Append a socket-delivered chat message and open/mark its private tab if needed. */
  function appendChatMessage(message: ChatMessage, tabId?: string) {
    setChatMessages((current) => [...current, message]);
    if (tabId) {
      setOpenChatTabs((current) => (current.includes(tabId) ? current : [...current, tabId]));
      if (message.fromPlayerId !== currentPlayerId && tabId !== activeChatTab) {
        setAttentionChatTabs((current) => (current.includes(tabId) ? current : [...current, tabId]));
        window.setTimeout(() => {
          setAttentionChatTabs((current) => current.filter((attentionTabId) => attentionTabId !== tabId));
        }, 3600);
      }
    }
  }

  /** Open a private chat only when the current player is allowed to message that target. */
  function openPrivateChat(playerId: string) {
    if (!playerId || !allowedPrivateChatIds.has(playerId)) {
      return false;
    }
    setOpenChatTabs((current) => (current.includes(playerId) ? current : [...current, playerId]));
    setActiveChatTab(playerId);
    setAttentionChatTabs((current) => current.filter((tabId) => tabId !== playerId));
    return true;
  }

  /** Close a private chat tab and return to public chat if it was active. */
  function closeChatTab(playerId: string) {
    setOpenChatTabs((current) => current.filter((tabId) => tabId !== playerId));
    setAttentionChatTabs((current) => current.filter((tabId) => tabId !== playerId));
    if (activeChatTab === playerId) {
      setActiveChatTab('public');
    }
  }

  /** Select a chat tab and clear its temporary attention marker. */
  function selectChatTab(tabId: string) {
    setActiveChatTab(tabId);
    setAttentionChatTabs((current) => current.filter((attentionTabId) => attentionTabId !== tabId));
  }

  return {
    activeChatTab,
    appendChatMessage,
    attentionChatTabs,
    chatDraft,
    closeChatTab,
    openChatTabs,
    openPrivateChat,
    setActiveChatTab: selectChatTab,
    setChatDraft,
    visibleChatMessages,
  };
}
