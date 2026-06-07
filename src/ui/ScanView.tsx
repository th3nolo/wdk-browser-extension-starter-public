import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { walletClient } from "./api";
import { Icon } from "./Icon";

/**
 * The camera QR scanner, rendered in a dedicated window (popup.html#scan). The
 * toolbar popup closes the instant the camera permission prompt steals focus,
 * so scanning can't happen there — this window stays open for the prompt, then
 * hands the decoded value back to the Send form via the SDK and closes itself.
 */
export function ScanView() {
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    let rafId = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scan();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to start the camera");
      }
    }

    async function found(value: string) {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
      try {
        await walletClient.submitScan(value);
      } catch {
        // If the callback fails the window still closes; the user can paste instead.
      }
      window.close();
    }

    function scan() {
      if (stopped) return;
      const video = videoRef.current;
      if (ctx && video && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (result?.data) {
          void found(result.data);
          return;
        }
      }
      rafId = window.requestAnimationFrame(scan);
    }

    void start();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <main className="scan-window wlt">
      <div className="section-title">
        <h2>Scan address QR</h2>
        <button className="icon sm" type="button" onClick={() => window.close()} title="Close"><Icon name="x" size={16} /></button>
      </div>
      <video ref={videoRef} className="scan-video" muted playsInline />
      {error
        ? <p className="error">{error}</p>
        : <p className="muted">Point your camera at a wallet-address QR code. Allow camera access if prompted.</p>}
    </main>
  );
}
