# Voice Audio

How Open Clocktower captures, processes, and transmits voice, and which knobs
exist per deployment. Voice is real-time **player-to-player WebRTC** (mesh per
voice room) — there is no cloud speech model or API key involved. The only
"model" in the chain is the local [RNNoise](https://github.com/xiph/rnnoise)
noise-suppression network, which runs as WASM inside the browser.

## Night keeps the microphone

When night takes a player out of voice, the capture pipeline is **silenced, not
released**: its audio tracks are disabled (nothing is captured or transmitted)
while `getUserMedia`, the processing graph, and the permission state stay alive.
Rejoining at sunrise therefore needs no new capture call — browsers defer or
refuse `getUserMedia` while a tab is in the background, which otherwise left
backgrounded players silent in both directions until they clicked their window.

Leaving voice manually, being kicked, and leaving the room still release the
microphone. The trade-off is that the browser's recording indicator stays lit for
the duration of the night, with the tracks disabled.

## Handshake recovery

Offer/answer runs over the room socket and a step can be lost (a reload, a phase
change, a peer that was not listening yet). The result used to be a peer stuck in
`have-local-offer`: not `failed`, so the ICE-restart path never fired, and not
missing, so the membership effect skipped it — voice stayed silent, often in one
direction only, until the player left and rejoined the voice room by hand.

The offering side therefore supervises each handshake: if the connection is not
`connected` after 9 s the peer is dropped and renegotiated from scratch, up to 3
times. Only the offering side supervises, so two peers can never tear each other
down in lockstep; the answering side is rebuilt by the retry offer. After the
last attempt the per-player diagnostic reads `could not connect - a TURN server
may be required`.

### Reading the diagnostics

**Settings → Voice → Player Volume** shows a live status line per remote player:

| Status | Meaning |
|--------|---------|
| `audio playing` | connected, audio is flowing |
| `connecting` / `handshake timed out - retrying` | negotiation in progress |
| `not connected` | no peer at all — the player is not in your voice room |
| `ICE failed` / `could not connect - a TURN server may be required` | no network path; configure TURN in `ICE_SERVERS_JSON` |
| `audio blocked - click Enable voice audio` | browser autoplay, not a connection problem |

## Capture chain

`getUserMedia` is requested with these constraints (see
`apps/frontend/src/audio/audioConstraints.ts`):

| Constraint | Value | Why |
| --- | --- | --- |
| `channelCount` | 1 (ideal) | Speech is mono; halves the bitrate for the same quality. |
| `sampleRate` | 48000 (ideal) | Native rate of both Opus and RNNoise; avoids resampling. |
| `sampleSize` | 16 (ideal) | Standard PCM depth. |
| `latency` | 0.02 (ideal) | Requests a small capture buffer where supported. |
| `echoCancellation` | on when Sound filters are on | Removes speaker echo for players without headphones. |
| `autoGainControl` | on when Sound filters are on | Evens out quiet/loud microphones. |
| `noiseSuppression` | engine-dependent (see below) | Never runs in series with RNNoise. |

### Noise suppression engines

The engine is selected by `VITE_VOICE_NOISE_SUPPRESSION` and applies when the
player's **Sound filters** toggle (Settings → Sound) is on:

- **`rnnoise` (default)** — the browser's native suppression is *disabled* and
  the RNNoise WASM model processes the microphone instead. Two suppressors in
  series eat consonants and make voices dull, so it is strictly one or the
  other. The RNNoise path adds a gentle chain after the model:
  high-pass 78 Hz (rumble only, below voice fundamentals) → presence shelf
  (+1.8 dB above 3.2 kHz, restoring the sparkle a neural denoiser shaves off
  consonants) → compressor (-24 dB, 3:1, 4 ms/240 ms) for consistent loudness
  → limiter (-2 dB safety ceiling against clipping). The output is 100%
  denoised signal — zero dry bleed, like commercial suppressors — and a
  residual-noise expander driven by RNNoise's own voice detection eases
  silence down another ~10 dB: speech opens it instantly on the same 10 ms
  frame (onsets are never clipped), a 400 ms hangover plus a ~120 ms ramp-down
  keep pauses between words untouched.
- **`native`** — the browser's built-in suppression (Chrome's is itself an
  RNNoise derivative and runs off the main thread with zero added latency).
- **`off`** — echo cancellation and gain control only.

RNNoise strictly needs a running 48 kHz audio engine. When a device cannot
provide one (44.1 kHz-only hardware, exclusive-mode Windows audio, autoplay
policy), the app **automatically re-captures the microphone with native
suppression** instead — noise suppression never silently disappears, and a
failed RNNoise start can never produce a silent outgoing track.

With Sound filters **off**, capture is completely raw (no EC/AGC/NS) — for
headphone users who want the unprocessed signal.

RNNoise runs on a `ScriptProcessorNode` (1024 samples ≈ 21 ms) rather than an
`AudioWorklet` on purpose: the rnnoise-wasm build refuses to load outside
window/Worker scopes, and worklet module imports are still unreliable in
Firefox/Safari. The 21 ms buffer rides out main-thread jank without audible
crackle.

## Transmission (Opus over WebRTC)

Codec settings negotiated per connection
(`apps/frontend/src/game-ui/hooks/useVoicePeers.ts`):

- **Opus preferred** over all other audio codecs (`setCodecPreferences`).
- **`useinbandfec=1`** — in-band forward error correction; single packet loss
  is reconstructed instead of crackling (default on).
- **`usedtx=0`** — discontinuous transmission off; DTX clips word onsets and
  pumps the noise floor, which players hear as static (default off).
- **`stereo=0`, `maxplaybackrate=48000`** — mono, fullband speech.
- **`maxaveragebitrate=64000`** — 64 kbps mono Opus is transparent for
  speech. Also applied as the RTP sender's `maxBitrate` with
  `priority: 'high'`.
- **`track.contentHint = 'speech'`** — the encoder optimizes for
  intelligibility.

Connection robustness:

- ICE servers come from the backend (`/api/config`, STUN + optional TURN;
  see [Deployment](deployment.md) for TURN setup).
- On `connectionState === 'failed'` the deterministic offerer side performs an
  **ICE restart** (max 2 attempts per peer) — recovers from network changes
  (Wi-Fi → LTE) without rejoining the room.
- A microphone that dies mid-session (USB unplugged, OS revoked) is detected
  via `track.onended` and capture **restarts automatically** on the default
  device.
- getUserMedia failures surface as actionable messages (permission blocked /
  no device / device busy / constraints unsupported) in Settings → Voice.

## Playback

Remote streams play through hidden `<audio autoplay playsinline>` elements
(the most reliable path in every browser). Chrome's autoplay policy is handled
by an "Enable voice audio" prompt plus automatic retry on the next user
gesture. Per-player volume above 100% routes through a `GainNode` on a single
shared `AudioContext`; speaking-indicator analysers share that context too,
because browsers cap AudioContexts per page (~6 in Chrome). Output-device
selection uses `setSinkId` where supported (Chrome/Edge; Firefox/Safari use
the system default).

## Environment variables

Set at **build time** for the frontend (Vite), e.g. in `apps/frontend/.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_VOICE_MAX_BITRATE` | `64000` | Opus target bitrate in bit/s (16000–256000). |
| `VITE_VOICE_FEC` | `true` | Opus in-band forward error correction. |
| `VITE_VOICE_DTX` | `false` | Opus discontinuous transmission (bandwidth saver, hurts quality). |
| `VITE_VOICE_NOISE_SUPPRESSION` | `rnnoise` | `rnnoise` \| `native` \| `off`. |

See `apps/frontend/.env.example`. TURN/STUN configuration stays server-side
(`docs/deployment.md`) and reaches clients via `/api/config`.

## Browser matrix

| Browser | Capture/processing | Notes |
| --- | --- | --- |
| Chrome / Edge (desktop + Android) | RNNoise, EC+AGC native | `setSinkId` output routing; autoplay unlock handled. |
| Firefox | RNNoise, EC+AGC native | No `setSinkId`; system default output. |
| Safari (macOS) | RNNoise, EC+AGC native | 48 kHz context available; autoplay unlock handled. |
| Safari (iOS) | usually native fallback | iOS often refuses non-44.1 kHz contexts → automatic native-NS fallback; interruption resume built in. |
| Older/exotic | native fallback | Any RNNoise start failure degrades to native suppression, never to nothing. |

Manual smoke test (two browsers/devices, one room): join Town Square in both,
speak — check clarity/loudness; mute/unmute; unplug the mic mid-call (expect
automatic default-mic recovery); toggle Sound filters in Settings and re-test;
switch networks on one side (expect "restarting" then recovery).
