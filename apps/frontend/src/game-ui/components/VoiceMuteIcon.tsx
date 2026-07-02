type VoiceMuteIconProps = {
  isMuted: boolean;
};

export function VoiceMuteIcon({ isMuted }: VoiceMuteIconProps) {
  return (
    <span className={isMuted ? 'voice-toggle-icon muted' : 'voice-toggle-icon'} aria-hidden="true">
      <svg focusable="false" viewBox="0 0 24 24">
        <path d="M12 3.25a3.25 3.25 0 0 0-3.25 3.25v5a3.25 3.25 0 0 0 6.5 0v-5A3.25 3.25 0 0 0 12 3.25Z" />
        <path d="M6.75 10.25a.75.75 0 0 1 .75.75v.5a4.5 4.5 0 0 0 9 0V11a.75.75 0 0 1 1.5 0v.5a6 6 0 0 1-5.25 5.95v2.05h2.75a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1 0-1.5h2.75v-2.05A6 6 0 0 1 6 11.5V11a.75.75 0 0 1 .75-.75Z" />
        {isMuted ? <path className="voice-toggle-strike" d="M5 4.75 19.25 19" /> : null}
      </svg>
    </span>
  );
}
