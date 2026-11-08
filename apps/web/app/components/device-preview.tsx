import { CameraIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";

type PreviewStatus = "requesting" | "live" | "blocked" | "unavailable";

const PREVIEW_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
  video: { width: { ideal: 1280 }, height: { ideal: 720 } },
};

/** Browsers report a refused or dismissed permission prompt with these names. */
export function isMediaPermissionDenied(cause: unknown) {
  return (
    cause instanceof DOMException &&
    (cause.name === "NotAllowedError" ||
      cause.name === "PermissionDeniedError" ||
      cause.name === "SecurityError")
  );
}

function stopStream(stream: MediaStream | undefined) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * Lets a participant check their camera and microphone with a local-only
 * stream. Nothing here is published to the room, and every track is stopped
 * when the preview closes so the browser's camera indicator turns off.
 */
export function DevicePreview() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PreviewStatus>("requesting");
  const [stream, setStream] = useState<MediaStream>();
  const streamRef = useRef<MediaStream>(undefined);
  const request = useRef(0);

  const stop = useCallback(() => {
    request.current += 1;
    stopStream(streamRef.current);
    streamRef.current = undefined;
    setStream(undefined);
  }, []);

  const start = useCallback(async () => {
    stop();
    const current = request.current;
    setStatus("requesting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    try {
      const next =
        await navigator.mediaDevices.getUserMedia(PREVIEW_CONSTRAINTS);
      // The preview was closed or restarted while the prompt was open.
      if (current !== request.current) {
        stopStream(next);
        return;
      }
      streamRef.current = next;
      setStream(next);
      setStatus("live");
    } catch (cause) {
      if (current !== request.current) return;
      setStatus(isMediaPermissionDenied(cause) ? "blocked" : "unavailable");
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  function close() {
    stop();
    setOpen(false);
  }

  return (
    <>
      <Button
        className="shrink-0"
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void start();
        }}
      >
        <CameraIcon aria-hidden="true" />
        Check Camera & Mic
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-editorial text-xl">
              Check camera & mic
            </DialogTitle>
            <DialogDescription>
              Only you can see this preview. Nothing is shared with the lobby.
            </DialogDescription>
          </DialogHeader>

          {status === "requesting" ? (
            <output className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 text-center text-sm text-neutral-200">
              <Spinner className="size-6" />
              Waiting for camera and microphone access…
              <span className="text-xs text-neutral-400">
                Choose Allow in your browser's prompt.
              </span>
            </output>
          ) : null}

          {status === "live" && stream ? (
            <div className="grid gap-3">
              <div className="aspect-video overflow-hidden rounded-lg bg-neutral-950">
                <PreviewVideo stream={stream} />
              </div>
              <MicLevelMeter stream={stream} />
            </div>
          ) : null}

          {status === "blocked" ? (
            <Alert variant="destructive">
              <AlertTitle>Camera and microphone access was blocked</AlertTitle>
              <AlertDescription>
                <p>
                  Your browser stopped this page from using them. To allow
                  access:
                </p>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>
                    Click the camera or lock icon in your browser's address bar.
                  </li>
                  <li>Set Camera and Microphone to Allow.</li>
                  <li>Click Try Again below.</li>
                </ol>
              </AlertDescription>
            </Alert>
          ) : null}

          {status === "unavailable" ? (
            <Alert variant="destructive">
              <AlertTitle>Camera or microphone couldn't start</AlertTitle>
              <AlertDescription>
                Check that a camera and microphone are connected and not in use
                by another app, then try again.
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            {status === "blocked" || status === "unavailable" ? (
              <Button type="button" onClick={() => void start()}>
                <RotateCcwIcon aria-hidden="true" />
                Try Again
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={close}>
              Close preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewVideo({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return undefined;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      aria-label="Your camera preview"
      autoPlay
      className="size-full -scale-x-100 object-cover"
      muted
      playsInline
      ref={video}
    />
  );
}

/** Draws the microphone's loudness without re-rendering every frame. */
function MicLevelMeter({ stream }: { stream: MediaStream }) {
  const meter = useRef<HTMLMeterElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      typeof AudioContext === "undefined" ||
      stream.getAudioTracks().length === 0
    )
      return undefined;

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let level = 0;
    let reported = -1;
    let frame = 0;

    const draw = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      // Speech sits well below full scale; boost it and let it fall smoothly.
      level = Math.max(Math.min(1, rms * 6), level * 0.9);
      if (bar.current) bar.current.style.width = `${level * 100}%`;
      const percent = Math.round(level * 100);
      if (percent !== reported && meter.current) {
        meter.current.value = percent;
        reported = percent;
      }
      frame = requestAnimationFrame(draw);
    };

    void context.resume().catch(() => {});
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span id="mic-level-label">Microphone level</span>
        <span>Speak to test your mic</span>
      </div>
      <meter
        aria-labelledby="mic-level-label"
        className="sr-only"
        max={100}
        min={0}
        ref={meter}
        value={0}
      />
      <div
        aria-hidden="true"
        className="h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full w-0 rounded-full bg-emerald-500" ref={bar} />
      </div>
    </div>
  );
}
