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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    setStatus("idle");
    setErrorMessage("");
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

      // Remote audio (translated speech) arrives as an inbound track.
      pc.ontrack = (e) => {
        const el = audioRef.current;
        if (!el) return;
        el.srcObject = e.streams[0];
        // iOS Safari needs an explicit play() even inside a user gesture flow.
        el.play().catch(() => {});
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // Data channel required by the Realtime API even if we don't send events.
      dcRef.current = pc.createDataChannel("oai-events");

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
  }, [cleanup]);

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
      <audio ref={audioRef} autoPlay playsInline hidden />
    </main>
  );
}
