/**
 * WebRTC voice peer hook.
 *
 * The hook owns peer connections, remote audio elements, ICE candidate queues,
 * codec preferences, output routing, volume, and diagnostic labels.
 */

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import type { VoiceParticipant } from '../voiceRooms';
import type { openRoomSocket } from '../../websocket/roomSocket';

type RoomSocketRef = MutableRefObject<ReturnType<typeof openRoomSocket> | null>;

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
  const remoteAudioContextRef = useRef<Record<string, AudioContext>>({});
  const remoteGainRef = useRef<Record<string, GainNode>>({});
  const joinedVoiceRoomRef = useRef<string | null>(null);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({});
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<Record<string, string>>({});

  useEffect(() => {
    Object.entries(remoteAudioRef.current).forEach(([playerId, audio]) => {
      const volume = remoteVolumes[playerId] ?? 1;
      audio.volume = Math.min(1, Math.max(0, volume));
      remoteGainRef.current[playerId]?.gain.setTargetAtTime(Math.max(0, Math.min(2, volume)), remoteAudioContextRef.current[playerId]?.currentTime ?? 0, 0.01);
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
    const retryPlayback = () => retryRemoteAudioPlayback();
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
        void createVoicePeer(playerId, true);
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
      setVoiceDiagnostics((current) => ({ ...current, [playerId]: peer.connectionState }));
      if (peer.connectionState === 'connected') {
        retryRemoteAudioPlayback();
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed') {
        setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'ice failed' }));
      }
    };
    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      let audioStream = remoteStream;
      let audioContext: AudioContext | null = null;
      let gain: GainNode | null = null;
      if (AudioContextClass) {
        void remoteAudioContextRef.current[playerId]?.close().catch(() => undefined);
        audioContext = new AudioContextClass();
        void audioContext.resume().catch(() => undefined);
        const source = audioContext.createMediaStreamSource(remoteStream);
        gain = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(destination);
        audioStream = destination.stream;
        remoteAudioContextRef.current[playerId] = audioContext;
        remoteGainRef.current[playerId] = gain;
      }
      const audio = remoteAudioRef.current[playerId] ?? new Audio();
      audio.autoplay = true;
      audio.controls = false;
      audio.muted = false;
      audio.setAttribute('playsinline', 'true');
      audio.srcObject = audioStream;
      const volume = remoteVolumes[playerId] ?? 1;
      audio.volume = Math.min(1, Math.max(0, volume));
      gain?.gain.setValueAtTime(Math.max(0, Math.min(2, volume)), audioContext?.currentTime ?? 0);
      void applyAudioSink(audio);
      remoteAudioRef.current[playerId] = audio;
      startVoiceLevelMonitor(playerId, remoteStream);
      if (!audio.parentElement) {
        audio.dataset.playerId = playerId;
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      playRemoteAudio(playerId, audio);
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

  /** Resume remote audio contexts and retry every remote audio element. */
  function retryRemoteAudioPlayback() {
    Object.values(remoteAudioContextRef.current).forEach((audioContext) => {
      if (audioContext.state !== 'closed') {
        void audioContext.resume().catch(() => undefined);
      }
    });
    Object.entries(remoteAudioRef.current).forEach(([playerId, audio]) => {
      if (audio.srcObject) {
        playRemoteAudio(playerId, audio);
      }
    });
  }

  /** Play one remote audio element and update diagnostics for autoplay failures. */
  function playRemoteAudio(playerId: string, audio: HTMLAudioElement) {
    void audio
      .play()
      .then(() => setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'audio playing' })))
      .catch(() => setVoiceDiagnostics((current) => ({ ...current, [playerId]: 'audio blocked - click anywhere' })));
  }

  /**
   * Tears down one remote peer and all browser audio objects attached to it.
   */
  function closeVoicePeer(playerId: string) {
    peerConnectionsRef.current[playerId]?.close();
    delete peerConnectionsRef.current[playerId];
    delete pendingIceCandidatesRef.current[playerId];
    stopVoiceLevelMonitor(playerId);
    const audio = remoteAudioRef.current[playerId];
    if (audio) {
      const stream = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
      stream?.getTracks().forEach((track) => track.stop());
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      delete remoteAudioRef.current[playerId];
    }
    void remoteAudioContextRef.current[playerId]?.close().catch(() => undefined);
    delete remoteAudioContextRef.current[playerId];
    delete remoteGainRef.current[playerId];
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
    handleVoiceSignal,
    remoteVolumes,
    setRemoteVolumes,
    setVoiceDiagnostics,
    voiceDiagnostics,
  };
}
