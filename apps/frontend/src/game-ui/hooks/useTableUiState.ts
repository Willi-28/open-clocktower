import { useEffect, useState } from 'react';

/**
 * Owns purely local table and panel UI state that is not part of the room model.
 */
export function useTableUiState() {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [selectedSeatActionPlayerId, setSelectedSeatActionPlayerId] = useState('');
  const [selectedBluffSlot, setSelectedBluffSlot] = useState<number | null>(null);
  const [selectedReminderLabel, setSelectedReminderLabel] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tableZoom, setTableZoom] = useState(1);
  const [activeNightOrderTab, setActiveNightOrderTab] = useState<'first' | 'other'>('first');

  useEffect(() => {
    const zoomTableWithCtrlWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        setTableZoom((current) => Math.max(0.72, Math.min(1.42, current + (event.deltaY < 0 ? 0.06 : -0.06))));
      }
    };
    window.addEventListener('wheel', zoomTableWithCtrlWheel, { passive: false });
    return () => window.removeEventListener('wheel', zoomTableWithCtrlWheel);
  }, []);

  return {
    activeNightOrderTab,
    isSettingsOpen,
    selectedBluffSlot,
    selectedPlayerId,
    selectedReminderLabel,
    selectedSeatActionPlayerId,
    setActiveNightOrderTab,
    setIsSettingsOpen,
    setSelectedBluffSlot,
    setSelectedPlayerId,
    setSelectedReminderLabel,
    setSelectedSeatActionPlayerId,
    tableZoom,
  };
}
