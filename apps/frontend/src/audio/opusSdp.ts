/**
 * Opus SDP tuning.
 *
 * Pure helpers that rewrite the Opus fmtp parameters of a WebRTC session
 * description. The fmtp line in OUR description tells the REMOTE encoder what
 * to send us, and both peers run this code, so every direction gets the same
 * treatment. fmtp munging is the interoperable way to set these parameters;
 * browsers ignore the ones they do not know.
 */

export type OpusSdpTuning = {
  /** Target average bitrate in bit/s (Opus `maxaveragebitrate`). */
  maxAverageBitrate: number;
  /** In-band forward error correction (`useinbandfec`). */
  forwardErrorCorrection: boolean;
  /** Discontinuous transmission during silence (`usedtx`). */
  discontinuousTransmission: boolean;
};

/** Rewrite every Opus fmtp line of an SDP with the given tuning. */
export function tuneOpusSdp(sdp: string, tuning: OpusSdpTuning): string {
  const opusPayloadTypes = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000(?:\/2)?\r?$/gim)].map((match) => match[1]);
  if (opusPayloadTypes.length === 0) {
    return sdp;
  }
  const parameters: Record<string, string> = {
    maxaveragebitrate: String(tuning.maxAverageBitrate),
    maxplaybackrate: '48000',
    stereo: '0',
    'sprop-stereo': '0',
    useinbandfec: tuning.forwardErrorCorrection ? '1' : '0',
    usedtx: tuning.discontinuousTransmission ? '1' : '0',
  };
  let tuned = sdp;
  for (const payloadType of opusPayloadTypes) {
    tuned = upsertFmtpLine(tuned, payloadType, parameters);
  }
  return tuned;
}

/** Merge parameters into an existing fmtp line or insert one after the rtpmap. */
function upsertFmtpLine(sdp: string, payloadType: string, updates: Record<string, string>): string {
  const fmtpPattern = new RegExp(`^a=fmtp:${payloadType} (.*)$`, 'im');
  const existing = sdp.match(fmtpPattern);
  if (existing) {
    const parameters = new Map<string, string>(
      existing[1]
        .trim()
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry): [string, string] => {
          const separator = entry.indexOf('=');
          return separator === -1 ? [entry, ''] : [entry.slice(0, separator), entry.slice(separator + 1)];
        }),
    );
    for (const [key, value] of Object.entries(updates)) {
      parameters.set(key, value);
    }
    const merged = [...parameters.entries()].map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join(';');
    return sdp.replace(fmtpPattern, `a=fmtp:${payloadType} ${merged}`);
  }
  // Consume the rtpmap line's own terminator so the inserted fmtp line reuses
  // it verbatim - SDP is CRLF-delimited and a bare \n corrupts the description.
  const rtpmapPattern = new RegExp(`^(a=rtpmap:${payloadType} opus\\/48000(?:\\/2)?)(\r?\n|$)`, 'im');
  const line = Object.entries(updates)
    .map(([key, value]) => `${key}=${value}`)
    .join(';');
  return sdp.replace(rtpmapPattern, `$1$2a=fmtp:${payloadType} ${line}$2`);
}
