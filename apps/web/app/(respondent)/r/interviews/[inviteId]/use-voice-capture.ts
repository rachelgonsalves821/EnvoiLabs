"use client";

import { useEffect, useRef, useState } from "react";

const formats = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"];
export const maxRecordingMs = 180_000;
const maxRecordingBytes = 20 * 1024 * 1024;

export type VoiceTake = { answerId: string; blob: Blob; localUrl: string; durationMs: number; mime: string };
type CaptureState =
  | { kind: "idle" | "permission" | "stopping" }
  | { kind: "recording"; elapsedSeconds: number }
  | { kind: "review"; take: VoiceTake };
type CaptureError = "unsupported" | "permissionDenied" | "recordingFailed" | "emptyRecording" | "largeRecording";
type ActiveCapture = { stop: () => void; dispose: () => void };

export function useVoiceCapture() {
  const [state, setState] = useState<CaptureState>({ kind: "idle" });
  const [error, setError] = useState<CaptureError | null>(null);
  const active = useRef<ActiveCapture | null>(null);
  const captureRequested = useRef(false);
  const generation = useRef(0);
  const preview = useRef<string | null>(null);
  const readLevel = useRef<() => number>(() => 0);

  function discardPreview() {
    if (!preview.current) return;
    URL.revokeObjectURL(preview.current);
    preview.current = null;
  }

  useEffect(() => () => {
    generation.current++;
    active.current?.dispose();
    discardPreview();
  }, []);

  async function start() {
    if (captureRequested.current || active.current) return;
    setError(null);
    const picked = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
      && formats.find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!picked || !navigator.mediaDevices?.getUserMedia) {
      setError("unsupported");
      return;
    }

    captureRequested.current = true;
    const request = ++generation.current;
    setState({ kind: "permission" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
    } catch (failure) {
      if (generation.current !== request) return;
      captureRequested.current = false;
      setState({ kind: "idle" });
      setError(failure instanceof DOMException && (failure.name === "NotAllowedError" || failure.name === "SecurityError")
        ? "permissionDenied" : "recordingFailed");
      return;
    }
    const releaseTracks = () => stream.getTracks().forEach((track) => track.stop());
    if (generation.current !== request) {
      releaseTracks();
      return;
    }
    captureRequested.current = false;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: picked, audioBitsPerSecond: 64_000 });
    } catch {
      releaseTracks();
      setState({ kind: "idle" });
      setError("recordingFailed");
      return;
    }

    let meter: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    if (typeof AudioContext !== "undefined") {
      try {
        meter = new AudioContext();
        source = meter.createMediaStreamSource(stream);
        const analyser = meter.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        readLevel.current = () => {
          analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
          return Math.min(1, Math.sqrt(energy / samples.length) * 4);
        };
        void meter.resume().catch(() => {});
      } catch {
        source?.disconnect();
        if (meter) void meter.close().catch(() => {});
      }
    }

    const parts: Blob[] = [];
    const startedAt = performance.now();
    let endedAt: number | undefined;
    const release = () => {
      readLevel.current = () => 0;
      source?.disconnect();
      if (meter) void meter.close().catch(() => {});
      clearInterval(ticker);
      clearTimeout(timeLimit);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      active.current = null;
      releaseTracks();
    };
    const stop = () => {
      if (recorder.state !== "recording") return;
      endedAt = performance.now();
      setState({ kind: "stopping" });
      recorder.stop();
    };
    const stopWhenHidden = () => {
      if (document.hidden) stop();
    };
    const ticker = setInterval(() => {
      if (recorder.state !== "recording") return;
      const elapsedSeconds = Math.floor((performance.now() - startedAt) / 1000);
      setState((current) => current.kind === "recording" && current.elapsedSeconds !== elapsedSeconds
        ? { kind: "recording", elapsedSeconds } : current);
    }, 250);
    const timeLimit = setTimeout(stop, maxRecordingMs);
    document.addEventListener("visibilitychange", stopWhenHidden);
    active.current = {
      stop,
      dispose() {
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.ondataavailable = null;
        if (recorder.state !== "inactive") recorder.stop();
        release();
      },
    };
    recorder.ondataavailable = ({ data }) => { if (data.size) parts.push(data); };
    recorder.onerror = () => {
      active.current?.dispose();
      setState({ kind: "idle" });
      setError("recordingFailed");
    };
    recorder.onstop = () => {
      release();
      const mime = (parts[0]?.type || recorder.mimeType || picked).split(";")[0]!.trim().toLowerCase();
      const blob = new Blob(parts, { type: mime });
      if (!blob.size || (mime !== "audio/webm" && mime !== "audio/mp4")) {
        setState({ kind: "idle" });
        setError("emptyRecording");
        return;
      }
      if (blob.size > maxRecordingBytes) {
        setState({ kind: "idle" });
        setError("largeRecording");
        return;
      }
      const durationMs = Math.min(maxRecordingMs, Math.max(1, Math.round((endedAt ?? performance.now()) - startedAt)));
      const localUrl = URL.createObjectURL(blob);
      discardPreview();
      preview.current = localUrl;
      setState({ kind: "review", take: { answerId: crypto.randomUUID(), blob, localUrl, durationMs, mime } });
    };

    try {
      recorder.start();
      setState({ kind: "recording", elapsedSeconds: 0 });
    } catch {
      active.current?.dispose();
      setState({ kind: "idle" });
      setError("recordingFailed");
    }
  }

  function discard() {
    discardPreview();
    setError(null);
    setState({ kind: "idle" });
  }

  return { state, error, start, stop: () => active.current?.stop(), discard,
    level: () => readLevel.current() };
}
