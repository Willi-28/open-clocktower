/**
 * WebRTC voice peer hook.
 *
 * The hook owns peer connections, remote audio elements, ICE candidate queues,
 * codec preferences, output routing, volume, and diagnostic labels.
 */

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { getSharedAudioContext } from '../../audio/browserAudio';
import { tuneOpusSdp } from '../../audio/opusSdp';
import { voiceConfig } from '../../audio/voiceConfig';
import type { VoiceParticipant } from '../voiceRooms';
import type { openRoomSocket } from '../../websocket/roomSocket';

type RoomSocketRef = MutableRefObject<ReturnType<typeof openRoomSocket> | null>;

type RemoteBoostChain = {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  destination: MediaStreamAudioDestinationNode;
  /** Chrome only feeds WebAudio from a remote WebRTC stream while some media
   * element plays it, so the boost keeps a muted element on the raw stream. */
  keepAlive: HTMLAudioElement;
};

/** Clamp a per-player volume to the supported 0-200% range. */
function clampRemoteVolume(volume: number) {
  return Math.max(0, Math.min(2, volume));
}

/**
 * Apply the configured Opus tuning (FEC, DTX policy, mono, 48 kHz playback,
 * average bitrate) to a local offer/answer before sending it out.
 */
function tunedDescription(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (!description.sdp) {
    return description;
  }
  return {
    type: description.type,
    sdp: tuneOpusSdp(description.sdp, {
      maxAverageBitrate: voiceConfig.maxBitrate,
      forwardErrorCorrection: voiceConfig.forwardErrorCorrection,
      discontinuousTransmission: voiceConfig.discontinuousTransmission,
    }),
  };
}

// One ICE restart usually rescues a network change; more than two attempts on
// a dead path just burns signaling.
const maxIceRestartAttempts = 2;

// Signals that arrive while this client is still joining are replayed after the
// join. The cap keeps a misbehaving peer from growing the buffer without bound;
// a real handshake is a handful of frames per peer.
const maxBufferedVoiceSignals = 64;

// A handshake can stall for two very different reasons, and they need opposite
// treatments:
//
// 1. No answer yet. The answering client may simply be slow - it buffers the
//    offer until it has joined the room with a live microphone, which was
//    measured at over ten seconds on a cold browser window. So this case is
//    handled by RE-SENDING THE SAME OFFER, never by building a new connection:
//    a late answer still belongs to the offer it is answering, so nothing can
//    be applied to the wrong session. Retransmitting is idempotent, which is
//    what makes it safe to do early and often.
// 2. The answer arrived but ICE never connected. Now no answer is in flight and
//    a genuine renegotiation is the only way forward. STUN checks retransmit
//    with backoff and a TURN allocation adds a round trip, so this budget has
//    to be generous.
//
// Anything near-instant (0.1 s) would abort every healthy connection before it
// could finish and never let voice come up at all.
const answerTimeoutMs = 3000;
const maxOfferResends = 4;
const iceTimeoutMs = 8000;
const maxNegotiationAttempts = 2;

type UseVoicePeersOptions = {
  applyAudioSink: (audio: HTMLAudioElement) => Promise<void>;
  currentPlayerId: string;
  getLocalVoiceStream: () => Promise<MediaStream>;
  iceServers: RTCIceServer[];
  initialRemoteVolumes: Record<string, number>;
  joinedVoiceRoom: string | null;
  onRemoteVolumesChange: (remoteVolumes: Record<string, number>) => void;
  roomSocketRef: RoomSocketRef;
  selectedAudioOutputId: string;
  startVoiceLevelMonitor: (playerId: string, stream: MediaStream) => void;
  stopVoiceLevelMonitor: (playerId: string) => void;
  voiceParticipants: VoiceParticipant[];
};

/**
 * Manages WebRTC peers, remote audio elements, and voice signaling.
 */
export function useVoicePeers({
  applyAudioSink,
  currentPlayerId,
  getLocalVoiceStream,
  iceServers,
  initialRemoteVolumes,
  joinedVoiceRoom,
  onRemoteVolumesChange,
  roomSocketRef,
  selectedAudioOutputId,
  startVoiceLevelMonitor,
  stopVoiceLevelMonitor,
  voiceParticipants,
}: UseVoicePeersOptions) {
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const iceRestartAttemptsRef = useRef<Record<string, number>>({});
  const remoteAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const remoteStreamRef = useRef<Record<string, MediaStream>>({});
  const remoteBoostRef = useRef<Record<string, RemoteBoostChain>>({});
  const joinedVoiceRoomRef = useRef<string | null>(null);
  const pendingVoiceSignalsRef = useRef<Array<{ fromPlayerId: string; signal: unknown }>>([]);
  const negotiationWatchdogsRef = useRef<Record<string, number>>({});
  const negotiationAttemptsRef = useRef<Record<string, number>>({});
  // Identifies the offer a peer is currently waiting on. Rebuilding a peer while
  // its answer is still travelling would otherwise apply that answer to the new
  // connection, which belongs to a different session.
  const negotiationIdsRef = useRef<Record<string, string>>({});
  // How often the current offer has been retransmitted while waiting for its answer.
  const offerResendsRef = useRef<Record<string, number>>({});
  // The last answer sent per peer, so a retransmitted offer can be answered
  // again without renegotiating a connection that may already be working.
  const lastAnswersRef = useRef<Record<string, { negotiationId?: string; description: RTCSessionDescriptionInit }>>({});
  // Bumped to re-run the membership effect when a peer was dropped without the
  // participant list itself changing.
  const [peerRetryNonce, setPeerRetryNonce] = useState(0);
  const [blockedRemoteAudioPlayerIds, setBlockedRemoteAudioPlayerIds] = useState<string[]>([]);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>(initialRemoteVolumes);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<Record<string, string>>({});
  const remoteVolumesRef = useRef(remoteVolumes);
  remoteVolumesRef.current = remoteVolumes;
  // Deafen (Discord-style headphone): mute every incoming remote audio element.
  const deafenedRef = useRef(false);

  /** Mute or unmute all remote audio at once (deafen toggle). */
  function setDeafened(deafened: boolean) {
    deafenedRef.current = deafened;
    Object.values(remoteAudioRef.current).forEach((audio) => {
      audio.muted = deafened;
    });
  }

  useEffect(() => {
    Object.entries(remoteAudioRef.current).forEach(([playerId, audio]) => {
      applyRemoteVolume(playerId, audio);
    });
  }, [remoteVolumes]);

  useEffect(() => {
    onRemoteVolumesChange(remoteVolumes);
  }, [onRemoteVolumesChange, remoteVolumes]);

  useEffect(() => {
    joinedVoiceRoomRef.current = joinedVoiceRoom;
    if (joinedVoiceRoom) {
      void replayPendingVoiceSignals();
      return;
    }
    // Left voice entirely: anything held from the previous session is stale.
    pendingVoiceSignalsRef.current = [];
  }, [joinedVoiceRoom]);

  useEffect(() => {
    Object.values(remoteAudioRef.current).forEach((audio) => {
      void applyAudioSink(audio);
    });
  }, [selectedAudioOutputId]);

  useEffect(() => {
    return () => closeAllVoicePeers();
  }, []);

  useEffect(() => {
    /** Retry autoplay-blocked remote audio after any user interaction. */
    const retryPlayback = () => {
      void enableVoiceAudio();
    };
    window.addEventListener('pointerdown', retryPlayback, true);
    window.addEventListener('keydown', retryPlayback, true);
    window.addEventListener('touchend', retryPlayback, true);
    return () => {
      window.removeEventListener('pointerdown', retryPlayback, true);
      window.removeEventListener('keydown', retryPlayback, true);
      window.removeEventListener('touchend', retryPlayback, true);
    };
  }, []);

  useEffect(() => {
    if (!joinedVoiceRoom || !currentPlayerId) {
      closeAllVoicePeers();
      return;
    }

    const sameRoomPlayers = voiceParticipants
      .filter((participant) => participant.voiceRoom === joinedVoiceRoom && participant.playerId !== currentPlayerId)
      .map((participant) => participant.playerId);

    Object.keys(peerConnectionsRef.current).forEach((playerId) => {
      if (!sameRoomPlayers.includes(playerId)) {
        closeVoicePeer(playerId);
        // They really left this room, so the next time they show up it is a
        // fresh negotiation and gets its full retry budget again.
        delete negotiationAttemptsRef.current[playerId];
      }
    });

    sameRoomPlayers.forEach((playerId) => {
      if (!peerConnectionsRef.current[playerId] && currentPlayerId < playerId) {
        void createVoicePeer(playerId, true).catch((caught) => {
          setVoiceDiagnostics((current) => ({ ...current, [playerId]: `connection error - ${voiceErrorMessage(caught)}` }));
        });
      }
    });
  }, [voiceParticipants, joinedVoiceRoom, currentPlayerId, peerRetryNonce]);

  /**
   * Watches one freshly created peer and rebuilds it if the handshake never
   * completes.
   *
   * Offer/answer is a multi-step exchange over the room socket, and a step can
   * be lost to a reload, a phase change, or a peer that was not listening yet.
   * A half-open connection then sits in `have-local-offer` forever: it is not
   * `failed`, so the ICE-restart path never fires, and the membership effect
   * skips it because an entry already exists - voice stays silent (often in one
   * direction only) until the player leaves and rejoins the room by hand.
   * Dropping the peer here lets the effect negotiate again from scratch.
   */
  function armNegotiationWatchdog(playerId: string) {
    window.clearTimeout(negotiationWatchdogsRef.current[playerId]);
    negotiationWatchdogsRef.current[playerId] = window.setTimeout(() => {
      const peer = peerConnectionsRef.current[playerId];
      if (!peer || peer.connectionState === 'connected') {
        return;
      }
      if (peer.signalingState === 'have-local-offer') {
        // Still waiting for the answer. Re-send the very same offer instead of
        // renegotiating: whether the answer was lost or merely slow, the reply
        // stays valid for this connection either way.
        const resends = offerResendsRef.current[playerId] ?? 0;
        if (resends < maxOfferResends && peer.localDescription) {
          offerResendsRef.current[playerId] = resends + 1;
          roomSocketRef.current?.sendVoiceSignal(playerId, {
            kind: 'offer',
            description: peer.localDescription,
            negotiationId: negotiationIdsRef.current[playerId],
          });
          setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'waiting for answer' }));
          armNegotiationWatchdog(playerId);
          return;
        }
        retryNegotiation(playerId, 'no answer - retrying');
        return;
      }
      // The answer is in and ICE is probing. Give it the room it needs.
      negotiationWatchdogsRef.current[playerId] = window.setTimeout(() => {
        const probing = peerConnectionsRef.current[playerId];
        if (!probing || probing.connectionState === 'connected') {
          return;
        }
        retryNegotiation(playerId, 'no media path - retrying');
      }, iceTimeoutMs);
    }, answerTimeoutMs);
  }

  /** Drop a stalled peer so the membership effect negotiates it again. */
  function retryNegotiation(playerId: string, message: string) {
    const attempts = negotiationAttemptsRef.current[playerId] ?? 0;
    if (attempts >= maxNegotiationAttempts) {
      setVoiceDiagnostics((current) => ({
        ...current,
        [playerId]: 'could not connect - a TURN server may be required',
      }));
      return;
    }
    negotiationAttemptsRef.current[playerId] = attempts + 1;
    closeVoicePeer(playerId);
    setVoiceDiagnostics((current) => ({ ...current, [playerId]: message }));
    // Membership has not changed, so nudge the effect into running again. The
    // rebuilt peer also picks up ICE servers that arrived after the first try.
    setPeerRetryNonce((current) => current + 1);
  }

  /**
   * Creates one peer connection and optionally starts the WebRTC offer flow.
   */
  async function createVoicePeer(playerId: string, shouldOffer: boolean) {
    const existing = peerConnectionsRef.current[playerId];
    if (existing) {
      return existing;
    }
    const peer = new RTCPeerConnection({ iceServers });
    peerConnectionsRef.current[playerId] = peer;
    setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'connecting' }));

    const stream = await getLocalVoiceStream();
    stream.getTracks().forEach((track) => {
      if (track.kind === 'audio') {
        // Tells the encoder to optimise for speech intelligibility over music.
        track.contentHint = 'speech';
      }
      const sender = peer.addTrack(track, stream);
      const parameters = sender.getParameters();
      parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      parameters.encodings[0].maxBitrate = voiceConfig.maxBitrate;
      parameters.encodings[0].priority = 'high';
      void sender.setParameters(parameters).catch(() => undefined);
    });
    preferOpus(peer);

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        roomSocketRef.current?.sendVoiceSignal(playerId, { kind: 'candidate', candidate: event.candidate.toJSON() });
      }
    };
    peer.onconnectionstatechange = () => {
      const connectionStateLabel =
        peer.connectionState === 'failed'
          ? 'connection failed - TURN may be needed'
          : peer.connectionState === 'disconnected'
            ? 'disconnected - retrying'
            : peer.connectionState;
      setVoiceDiagnostics((current) => ({ ...current, [playerId]: connectionStateLabel }));
      if (peer.connectionState === 'connected') {
        iceRestartAttemptsRef.current[playerId] = 0;
        negotiationAttemptsRef.current[playerId] = 0;
        window.clearTimeout(negotiationWatchdogsRef.current[playerId]);
        delete negotiationWatchdogsRef.current[playerId];
        void enableVoiceAudio();
      }
      if (peer.connectionState === 'failed') {
        void restartIceForPeer(playerId, peer);
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed') {
        setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'ICE failed - TURN may be needed' }));
      }
      if (peer.iceConnectionState === 'disconnected') {
        setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'ICE disconnected - network changed' }));
      }
    };
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current[playerId] = remoteStream;
      disconnectRemoteBoostChain(playerId);
      const audio = remoteAudioRef.current[playerId] ?? new Audio();
      audio.autoplay = true;
      audio.controls = false;
      audio.muted = deafenedRef.current;
      audio.preload = 'auto';
      audio.setAttribute('playsinline', 'true');
      audio.srcObject = remoteStream;
      applyRemoteVolume(playerId, audio);
      void applyAudioSink(audio);
      remoteAudioRef.current[playerId] = audio;
      startVoiceLevelMonitor(playerId, remoteStream);
      if (!audio.parentElement) {
        audio.dataset.playerId = playerId;
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      void playRemoteAudio(playerId, audio);
    };

    if (shouldOffer) {
      const offer = tunedDescription(await peer.createOffer());
      await peer.setLocalDescription(offer);
      sendOffer(playerId, offer);
      // Only the offering side supervises the handshake, so the two peers can
      // never tear each other down in lockstep. The answering side is rebuilt
      // by the retry offer that this watchdog produces.
      armNegotiationWatchdog(playerId);
    }
    return peer;
  }

  /**
   * Re-negotiates a failed peer over fresh ICE candidates (network change,
   * dead TURN allocation). Only the deterministic offerer side restarts so the
   * two peers cannot glare; attempts are capped per peer.
   */
  async function restartIceForPeer(playerId: string, peer: RTCPeerConnection) {
    const isOfferer = currentPlayerId < playerId;
    const attempts = iceRestartAttemptsRef.current[playerId] ?? 0;
    if (!isOfferer || attempts >= maxIceRestartAttempts || peerConnectionsRef.current[playerId] !== peer) {
      return;
    }
    iceRestartAttemptsRef.current[playerId] = attempts + 1;
    setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'connection failed - restarting' }));
    try {
      // Older Safari lacks restartIce(); the createOffer flag does the same.
      const hasRestartIce = typeof peer.restartIce === 'function';
      if (hasRestartIce) {
        peer.restartIce();
      }
      const offer = tunedDescription(await peer.createOffer(hasRestartIce ? {} : { iceRestart: true }));
      await peer.setLocalDescription(offer);
      sendOffer(playerId, offer);
    } catch (caught) {
      setVoiceDiagnostics((current) => ({ ...current, [playerId]: `restart failed - ${voiceErrorMessage(caught)}` }));
    }
  }

  /**
   * Keeps speech on Opus even when browsers expose additional audio codecs.
   */
  function preferOpus(peer: RTCPeerConnection) {
    if (!RTCRtpReceiver.getCapabilities) {
      return;
    }
    const codecs = RTCRtpReceiver.getCapabilities('audio')?.codecs;
    if (!codecs) {
      return;
    }
    const opus = codecs.filter((codec) => codec.mimeType.toLowerCase() === 'audio/opus');
    const remaining = codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'audio/opus');
    peer.getTransceivers()
      .filter((transceiver) => transceiver.sender.track?.kind === 'audio')
      .forEach((transceiver) => {
        try {
          transceiver.setCodecPreferences([...opus, ...remaining]);
        } catch {
          // Older browsers can still negotiate audio with their default codec order.
        }
      });
  }

  /**
   * Applies offer, answer, and ICE signaling messages from the room socket.
   */
  async function handleVoiceSignal(fromPlayerId: string, rawSignal: unknown) {
    try {
      if (!joinedVoiceRoomRef.current) {
        // A peer can offer before this client has finished (re)joining: joining
        // waits for the microphone, so whoever's device comes up first offers
        // into a peer that is not listening yet. This is systematic at sunrise,
        // where the server moves the whole table into the main room at the same
        // moment. Dropping the offer stranded that peer permanently - the
        // offerer keeps its half-open connection and never re-offers, so voice
        // stayed one-sided until the room was switched and re-joined. Hold the
        // signal instead and replay it once the join completes.
        if (pendingVoiceSignalsRef.current.length < maxBufferedVoiceSignals) {
          pendingVoiceSignalsRef.current.push({ fromPlayerId, signal: rawSignal });
        }
        return;
      }
      const signal = rawSignal as {
        kind?: 'offer' | 'answer' | 'candidate';
        description?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
        negotiationId?: string;
      };
      const alreadyAnswered = lastAnswersRef.current[fromPlayerId];
      if (signal.kind === 'offer' && alreadyAnswered && alreadyAnswered.negotiationId === signal.negotiationId) {
        // This offer was already answered; the other side just did not hear us.
        // Repeat the same answer rather than renegotiating.
        roomSocketRef.current?.sendVoiceSignal(fromPlayerId, {
          kind: 'answer',
          description: alreadyAnswered.description,
          negotiationId: signal.negotiationId,
        });
        return;
      }
      const existing = peerConnectionsRef.current[fromPlayerId];
      if (signal.kind === 'offer' && existing && !canApplyRemoteOffer(existing)) {
        // Only rebuild when this peer genuinely cannot take the offer. A repeat
        // offer usually means the other side started over, and applying it as a
        // renegotiation keeps the ICE checks that are already running - tearing
        // the peer down instead threw away handshakes that were about to
        // succeed and left both sides stuck in "connecting".
        closeVoicePeer(fromPlayerId);
      }
      const peer = await createVoicePeer(fromPlayerId, false);
      if (signal.kind === 'offer' && signal.description) {
        await peer.setRemoteDescription(signal.description);
        await flushPendingIceCandidates(fromPlayerId, peer);
        const answer = tunedDescription(await peer.createAnswer());
        await peer.setLocalDescription(answer);
        lastAnswersRef.current[fromPlayerId] = { negotiationId: signal.negotiationId, description: answer };
        // Echo the offer's id so the other side can tell this answer apart from
        // one belonging to an offer it has already given up on.
        roomSocketRef.current?.sendVoiceSignal(fromPlayerId, {
          kind: 'answer',
          description: answer,
          negotiationId: signal.negotiationId,
        });
      }
      if (signal.kind === 'answer' && signal.description) {
        const awaiting = negotiationIdsRef.current[fromPlayerId];
        // Only reject an answer that names a DIFFERENT negotiation. An answer
        // without an id comes from a client that does not send one (an older
        // build, or the packaged desktop bundle); rejecting those would silence
        // voice against that peer completely, which is far worse than the rare
        // late answer this check exists to catch.
        if (signal.negotiationId !== undefined && signal.negotiationId !== awaiting) {
          // Applying it would hand the current connection a description from a
          // different session - the InvalidStateError and instant "failed".
          return;
        }
        await peer.setRemoteDescription(signal.description);
        await flushPendingIceCandidates(fromPlayerId, peer);
      }
      if (signal.kind === 'candidate' && signal.candidate) {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(signal.candidate).catch(() => undefined);
        } else {
          pendingIceCandidatesRef.current[fromPlayerId] = [
            ...(pendingIceCandidatesRef.current[fromPlayerId] ?? []),
            signal.candidate,
          ];
        }
      }
    } catch (caught) {
      setVoiceDiagnostics((current) => ({ ...current, [fromPlayerId]: `signal error - ${voiceErrorMessage(caught)}` }));
    }
  }

  /**
   * Send an offer and remember which negotiation it starts.
   *
   * Every offer gets a fresh id that the answering side echoes back, so an
   * answer to a superseded offer can be recognised and dropped instead of
   * corrupting the connection that replaced it.
   */
  function sendOffer(playerId: string, description: RTCSessionDescriptionInit) {
    const negotiationId = crypto.randomUUID();
    negotiationIdsRef.current[playerId] = negotiationId;
    offerResendsRef.current[playerId] = 0;
    roomSocketRef.current?.sendVoiceSignal(playerId, { kind: 'offer', description, negotiationId });
  }

  /**
   * Whether a remote offer can still be applied to this peer.
   *
   * `stable` and `have-remote-offer` accept one (a renegotiation); `have-local-
   * offer` is glare and `closed` is unusable, so those need a fresh peer.
   */
  function canApplyRemoteOffer(peer: RTCPeerConnection) {
    return peer.signalingState === 'stable' || peer.signalingState === 'have-remote-offer';
  }

  /**
   * Replays signals that arrived while this client was still joining.
   *
   * Order is preserved so an offer is still applied before its candidates.
   */
  async function replayPendingVoiceSignals() {
    const buffered = pendingVoiceSignalsRef.current;
    if (buffered.length === 0) {
      return;
    }
    pendingVoiceSignalsRef.current = [];
    for (const { fromPlayerId, signal } of buffered) {
      await handleVoiceSignal(fromPlayerId, signal);
    }
  }

  /**
   * Adds queued ICE candidates after the remote session description exists.
   */
  async function flushPendingIceCandidates(playerId: string, peer: RTCPeerConnection) {
    const candidates = pendingIceCandidatesRef.current[playerId] ?? [];
    delete pendingIceCandidatesRef.current[playerId];
    for (const candidate of candidates) {
      await peer.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  /**
   * Apply one player's volume to their audio element.
   *
   * Up to 100% the element plays the raw WebRTC stream directly - the most
   * reliable path in every browser. Only above 100% is the stream routed
   * through a GainNode on the shared AudioContext; if that boost cannot be
   * built the element keeps playing the raw stream capped at 100%.
   */
  function applyRemoteVolume(playerId: string, audio: HTMLAudioElement) {
    const volume = clampRemoteVolume(remoteVolumesRef.current[playerId] ?? 1);
    const rawStream = remoteStreamRef.current[playerId];
    if (volume > 1 && rawStream) {
      const chain = ensureRemoteBoostChain(playerId, rawStream);
      if (chain) {
        chain.gain.gain.setTargetAtTime(volume, chain.gain.context.currentTime, 0.02);
        if (audio.srcObject !== chain.destination.stream) {
          audio.srcObject = chain.destination.stream;
          void playRemoteAudio(playerId, audio);
        }
        audio.volume = 1;
        return;
      }
    }
    if (remoteBoostRef.current[playerId]) {
      disconnectRemoteBoostChain(playerId);
      if (rawStream && audio.srcObject !== rawStream) {
        audio.srcObject = rawStream;
        void playRemoteAudio(playerId, audio);
      }
    }
    audio.volume = Math.min(1, volume);
  }

  /** Create (or reuse) the WebAudio chain that lifts a remote stream above 100%. */
  function ensureRemoteBoostChain(playerId: string, rawStream: MediaStream) {
    const existing = remoteBoostRef.current[playerId];
    if (existing && existing.source.mediaStream === rawStream) {
      return existing;
    }
    disconnectRemoteBoostChain(playerId);
    try {
      const audioContext = getSharedAudioContext();
      if (!audioContext) {
        return null;
      }
      const source = audioContext.createMediaStreamSource(rawStream);
      const gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);
      // Chrome workaround: WebAudio only receives remote WebRTC audio while
      // some media element plays the raw stream, so park it on a muted one.
      const keepAlive = new Audio();
      keepAlive.autoplay = true;
      keepAlive.muted = true;
      keepAlive.setAttribute('playsinline', 'true');
      keepAlive.srcObject = rawStream;
      void keepAlive.play().catch(() => undefined);
      const chain = { source, gain, destination, keepAlive };
      remoteBoostRef.current[playerId] = chain;
      return chain;
    } catch {
      return null;
    }
  }

  /** Detach one player's boost chain from the shared AudioContext. */
  function disconnectRemoteBoostChain(playerId: string) {
    const chain = remoteBoostRef.current[playerId];
    if (chain) {
      chain.source.disconnect();
      chain.gain.disconnect();
      chain.keepAlive.pause();
      chain.keepAlive.srcObject = null;
      delete remoteBoostRef.current[playerId];
    }
  }

  /** Track whether Chrome/Brave need an explicit user gesture for remote audio. */
  function setRemoteAudioBlocked(playerId: string, isBlocked: boolean) {
    setBlockedRemoteAudioPlayerIds((current) => {
      const alreadyBlocked = current.includes(playerId);
      if (isBlocked === alreadyBlocked) {
        return current;
      }
      return isBlocked ? [...current, playerId] : current.filter((id) => id !== playerId);
    });
  }

  /** Retry every remote audio element from a user click or trusted browser event. */
  async function enableVoiceAudio() {
    // Also resumes the shared AudioContext the volume boost chains run on.
    getSharedAudioContext();
    const entries = Object.entries(remoteAudioRef.current).filter(([, audio]) => audio.srcObject);
    if (entries.length === 0) {
      setBlockedRemoteAudioPlayerIds([]);
      return true;
    }
    const results = await Promise.all(entries.map(([playerId, audio]) => playRemoteAudio(playerId, audio)));
    return results.every(Boolean);
  }

  /** Play one remote audio element and update diagnostics for autoplay failures. */
  async function playRemoteAudio(playerId: string, audio: HTMLAudioElement) {
    try {
      await audio.play();
      setRemoteAudioBlocked(playerId, false);
      setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'audio playing' }));
      return true;
    } catch (caught) {
      const isBlocked = isAutoplayBlocked(caught);
      setRemoteAudioBlocked(playerId, isBlocked);
      setVoiceDiagnostics((current) => ({
        ...current,
        [playerId]: isBlocked
          ? 'audio blocked - click Enable voice audio'
          : `audio playback error - ${voiceErrorMessage(caught)}`,
      }));
      return false;
    }
  }

  /** Detect browser autoplay blocking errors without treating every playback error as user-action related. */
  function isAutoplayBlocked(caught: unknown) {
    if (caught instanceof DOMException && caught.name === 'NotAllowedError') {
      return true;
    }
    const message = voiceErrorMessage(caught).toLowerCase();
    return (
      message.includes('notallowed') ||
      message.includes('not allowed') ||
      message.includes('user gesture') ||
      message.includes("user didn't interact") ||
      message.includes('autoplay')
    );
  }

  /** Convert WebRTC and media errors into short diagnostics for the settings UI. */
  function voiceErrorMessage(caught: unknown) {
    if (caught instanceof DOMException) {
      return caught.name;
    }
    if (caught instanceof Error) {
      return caught.message || caught.name;
    }
    return 'unknown error';
  }

  /**
   * Tears down one remote peer and all browser audio objects attached to it.
   */
  function closeVoicePeer(playerId: string) {
    window.clearTimeout(negotiationWatchdogsRef.current[playerId]);
    delete negotiationWatchdogsRef.current[playerId];
    delete negotiationIdsRef.current[playerId];
    delete offerResendsRef.current[playerId];
    delete lastAnswersRef.current[playerId];
    peerConnectionsRef.current[playerId]?.close();
    delete peerConnectionsRef.current[playerId];
    delete pendingIceCandidatesRef.current[playerId];
    delete iceRestartAttemptsRef.current[playerId];
    stopVoiceLevelMonitor(playerId);
    // The element may play the boosted stream, so stop the raw remote tracks too.
    remoteStreamRef.current[playerId]?.getTracks().forEach((track) => track.stop());
    delete remoteStreamRef.current[playerId];
    disconnectRemoteBoostChain(playerId);
    const audio = remoteAudioRef.current[playerId];
    if (audio) {
      const stream = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
      stream?.getTracks().forEach((track) => track.stop());
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      delete remoteAudioRef.current[playerId];
    }
    setRemoteAudioBlocked(playerId, false);
    setVoiceDiagnostics((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  /**
   * Closes every peer connection when leaving a room or switching voice rooms.
   */
  function closeAllVoicePeers() {
    Object.keys(peerConnectionsRef.current).forEach(closeVoicePeer);
  }

  return {
    closeAllVoicePeers,
    enableVoiceAudio,
    handleVoiceSignal,
    needsVoiceAudioUnlock: blockedRemoteAudioPlayerIds.length > 0,
    remoteVolumes,
    setDeafened,
    setRemoteVolumes,
    setVoiceDiagnostics,
    voiceDiagnostics,
  };
}
