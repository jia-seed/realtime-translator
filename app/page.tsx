"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "listening" | "error";

interface SessionResponse {
  value?: string;
  session?: { model?: string };
  error?: string;
}

const DEFAULT_MODEL = "gpt-realtime-2.1";

export default function Page() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [transcript, setTranscript] = useState<string>("");
  const [waiting, setWaiting] = useState<boolean>(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingTranscriptRef = useRef<string>("");
  // Announce "waiting for a second language" exactly once, and stop once the
  // model actually starts translating (its first audio output).
  const announcedRef = useRef<boolean>(false);
  const translatingRef = useRef<boolean>(false);

  const announceWaiting = useCallback(() => {
    if (announcedRef.current || translatingRef.current) return;
    announcedRef.current = true;
    setWaiting(true);
    try {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
      if (synth) {
        synth.cancel();
        synth.speak(
          new SpeechSynthesisUtterance(
            "Waiting for a second language for two-translation."
          )
        );
      }
    } catch {}
  }, []);

  const cleanup = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {}
      dcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    try {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    } catch {}
    setStatus("idle");
    setErrorMessage("");
    setTranscript("");
    setWaiting(false);
    pendingTranscriptRef.current = "";
    announcedRef.current = false;
    translatingRef.current = false;
  }, [cleanup]);

  const start = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage("");

    try {
      const resp = await fetch("/api/session", { method: "POST" });
      const data: SessionResponse = await resp.json();
      if (data.error || !data.value) {
        throw new Error(data.error || "Missing ephemeral key in session response");
      }
      const EPHEMERAL_KEY = data.value;
      const MODEL = data.session?.model || DEFAULT_MODEL;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        console.log("[rtc] connectionState:", pc.connectionState);
      };
      pc.oniceconnectionstatechange = () => {
        console.log("[rtc] iceConnectionState:", pc.iceConnectionState);
      };

      // Remote audio (translated speech) arrives as an inbound track.
      pc.ontrack = (e) => {
        console.log("[rtc] ontrack", e.track.kind, "streams:", e.streams.length);
        const el = audioRef.current;
        if (!el) {
          console.warn("[rtc] audio ref missing when track arrived");
          return;
        }
        el.srcObject = e.streams[0];
        el.volume = 1;
        el.muted = false;
        el.play().catch((err) => console.warn("[rtc] audio.play() rejected:", err));
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          const type: string = event.type ?? "";
          if (type === "conversation.item.input_audio_transcription.delta") {
            pendingTranscriptRef.current += event.delta ?? "";
            setTranscript(pendingTranscriptRef.current);
          } else if (type === "conversation.item.input_audio_transcription.completed") {
            const finalText = event.transcript ?? pendingTranscriptRef.current;
            pendingTranscriptRef.current = "";
            setTranscript(finalText);
            // First utterance heard and the model isn't translating yet, so it
            // only has one language: announce that we're waiting for a second.
            if (!translatingRef.current) announceWaiting();
          } else if (
            type === "output_audio_buffer.started" ||
            type === "response.output_audio.delta" ||
            type === "response.audio.delta"
          ) {
            // The model produced translated speech, so a second language has
            // arrived. Stop the "waiting" state for the rest of the session.
            if (!translatingRef.current) {
              translatingRef.current = true;
              setWaiting(false);
              try {
                if (typeof window !== "undefined") window.speechSynthesis?.cancel();
              } catch {}
            }
          }
        } catch {}
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(MODEL)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp",
          },
        }
      );

      const answerSdp = await sdpResp.text();
      if (!sdpResp.ok) {
        throw new Error(`Realtime handshake failed (${sdpResp.status}): ${answerSdp.slice(0, 300)}`);
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setStatus("listening");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cleanup();
      setErrorMessage(message);
      setStatus("error");
    }
  }, [cleanup, announceWaiting]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleClick = () => {
    if (status === "listening") {
      stop();
    } else if (status === "idle" || status === "error") {
      void start();
    }
  };

  const isRecording = status === "listening";
  const isConnecting = status === "connecting";

  const statusText =
    status === "idle"
      ? "Tap to start"
      : status === "connecting"
        ? "Connecting…"
        : status === "listening"
          ? "Listening"
          : `Error: ${errorMessage}`;

  return (
    <main>
      <button
        type="button"
        className={`mic-button${isRecording ? " recording" : ""}`}
        onClick={handleClick}
        disabled={isConnecting}
        aria-pressed={isRecording}
        aria-label={isRecording ? "Stop translating" : "Start translating"}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"
            fill="currentColor"
          />
          <path
            d="M5 12a7 7 0 0 0 14 0M12 19v3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <p className={`status${status === "error" ? " error" : ""}`} role="status">
        {statusText}
      </p>
      {waiting && (
        <p className="waiting" role="status">
          Waiting for a second language for two-translation…
        </p>
      )}
      {transcript && <p className="transcript">{transcript}</p>}
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
      />
    </main>
  );
}
