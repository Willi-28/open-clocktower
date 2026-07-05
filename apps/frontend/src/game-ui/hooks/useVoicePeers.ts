/**
 * WebRTC voice peer hook.
 *
 * The hook owns peer connections, remote audio elements, ICE candidate queues,
 * codec preferences, output routing, volume, and diagnostic labels.
 */

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { getSharedAudioContext } from '../../audio/browserAudio';
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

type UseVoicePeersOptions = {
  applyAudioSink: (audio: HTMLAudioElement) => Promise<void>;
  currentPlayerId: string;
  getLocalVoiceStream: () => Promise<MediaStream>;
  iceServers: RTCIceServer[];
  joinedVoiceRoom: string | null;
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
  joinedVoiceRoom,
  roomSocketRef,
  selectedAudioOutputId,
  startVoiceLevelMonitor,
  stopVoiceLevelMonitor,
  voiceParticipants,
}: UseVoicePeersOptions) {
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const remoteAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const remoteStreamRef = useRef<Record<string, MediaStream>>({});
  const remoteBoostRef = useRef<Record<string, RemoteBoostChain>>({});
  const joinedVoiceRoomRef = useRef<string | null>(null);
  const [blockedRemoteAudioPlayerIds, setBlockedRemoteAudioPlayerIds] = useState<string[]>([]);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({});
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<Record<string, string>>({});
  const remoteVolumesRef = useRef(remoteVolumes);
  remoteVolumesRef.current = remoteVolumes;

  useEffect(() => {
    Object.entries(remoteAudioRef.current).forEach(([playerId, audio]) => {
      applyRemoteVolume(playerId, audio);
    });
  }, [remoteVolumes]);

  useEffect(() => {
    joinedVoiceRoomRef.current = joinedVoiceRoom;
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
      }
    });

    sameRoomPlayers.forEach((playerId) => {
      if (!peerConnectionsRef.current[playerId] && currentPlayerId < playerId) {
        void createVoicePeer(playerId, true).catch((caught) => {
          setVoiceDiagnostics((current) => ({ ...current, [playerId]: `connection error - ${voiceErrorMessage(caught)}` }));
        });
      }
    });
  }, [voiceParticipants, joinedVoiceRoom, currentPlayerId]);

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
        track.contentHint = 'speech';
      }
      const sender = peer.addTrack(track, stream);
      const parameters = sender.getParameters();
      parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      parameters.encodings[0].maxBitrate = 128000;
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
        void enableVoiceAudio();
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
      audio.muted = false;
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
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      roomSocketRef.current?.sendVoiceSignal(playerId, { kind: 'offer', description: offer });
    }
    return peer;
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
        return;
      }
      const signal = rawSignal as {
        kind?: 'offer' | 'answer' | 'candidate';
        description?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };
      const peer = await createVoicePeer(fromPlayerId, false);
      if (signal.kind === 'offer' && signal.description) {
        await peer.setRemoteDescription(signal.description);
        await flushPendingIceCandidates(fromPlayerId, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        roomSocketRef.current?.sendVoiceSignal(fromPlayerId, { kind: 'answer', description: answer });
      }
      if (signal.kind === 'answer' && signal.description) {
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
    peerConnectionsRef.current[playerId]?.close();
    delete peerConnectionsRef.current[playerId];
    delete pendingIceCandidatesRef.current[playerId];
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
    setRemoteVolumes,
    setVoiceDiagnostics,
    voiceDiagnostics,
  };
}
