import { useEffect, useRef, useState } from 'react';

type UseDiscussionTimerOptions = {
  isStoryteller: boolean;
  onRingBell: () => void;
  onSyncTimer: (durationSeconds: number, remainingSeconds: number, isRunning: boolean) => void;
};

export function useDiscussionTimer({ isStoryteller, onRingBell, onSyncTimer }: UseDiscussionTimerOptions) {
  const timerTickAnchorRef = useRef(Date.now());
  const [timerSeconds, setTimerSeconds] = useState(300);
  const [timerRemaining, setTimerRemaining] = useState(300);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const [showTimerDone, setShowTimerDone] = useState(false);

  useEffect(() => {
    if (!isTimerRunning || !timerStartedAt) {
      return;
    }
    timerTickAnchorRef.current = Date.now();
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - timerTickAnchorRef.current) / 1000));
      if (elapsed === 0) {
        return;
      }
      setTimerRemaining((current) => {
        const nextRemaining = Math.max(0, current - elapsed);
        if (nextRemaining === 0) {
          window.clearInterval(intervalId);
          setIsTimerRunning(false);
          setTimerStartedAt(null);
          onRingBell();
          setShowTimerDone(true);
          if (isStoryteller) {
            onSyncTimer(timerSeconds, 0, false);
          }
        }
        return nextRemaining;
      });
      timerTickAnchorRef.current = now;
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isStoryteller, isTimerRunning, onRingBell, onSyncTimer, timerSeconds, timerStartedAt]);

  useEffect(() => {
    if (!showTimerDone) {
      return;
    }
    const timeoutId = window.setTimeout(() => setShowTimerDone(false), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [showTimerDone]);

  function applyTimerState(durationSeconds: number, remainingSeconds: number, isRunning: boolean, startedAt?: string | null) {
    setTimerSeconds(durationSeconds);
    setTimerRemaining(remainingSeconds);
    setIsTimerRunning(isRunning);
    timerTickAnchorRef.current = Date.now();
    setTimerStartedAt(isRunning && startedAt ? new Date().toISOString() : null);
  }

  function resetTimer(nextSeconds = timerSeconds) {
    setTimerSeconds(nextSeconds);
    setTimerRemaining(nextSeconds);
    setIsTimerRunning(false);
    setTimerStartedAt(null);
    onSyncTimer(nextSeconds, nextSeconds, false);
  }

  function toggleTimer() {
    const nextRunning = !isTimerRunning;
    const nextRemaining = nextRunning && timerRemaining === 0 ? timerSeconds : timerRemaining;
    if (nextRunning && timerRemaining === 0) {
      setTimerRemaining(timerSeconds);
      setShowTimerDone(false);
    }
    setIsTimerRunning(nextRunning);
    setTimerStartedAt(nextRunning ? new Date().toISOString() : null);
    onSyncTimer(timerSeconds, nextRemaining, nextRunning);
  }

  return {
    applyTimerState,
    isTimerRunning,
    resetTimer,
    showTimerDone,
    timerRemaining,
    timerSeconds,
    toggleTimer,
  };
}
