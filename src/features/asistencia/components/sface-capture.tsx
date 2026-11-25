"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";

export function SFaceCapture({
  personaId,
  storeId,
  autoOpen = false,
  onVerified,
  management = false,
  evaluation,
  onResult,
}: {
  personaId: string;
  storeId: string;
  autoOpen?: boolean;
  onVerified?: (grant: string, score: number) => void;
  management?: boolean;
  evaluation?: { kind: string; lighting: string; device: string };
  onResult?: (result: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"enroll" | "verify">("verify");
  const [consent, setConsent] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const biometricSession = useRef<{ id: string; challenge: string } | null>(null);
  const running = useRef(false);
  async function call(operation: string, extra = {}) {
    const response = await fetch("/api/asistencia/biometria", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, personaId, storeId, evaluation: Boolean(evaluation), ...extra }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message ??
          result.detail ??
          "No se pudo completar la verificación.",
      );
    return result;
  }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then(async (media) => {
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
      })
      .catch(() => setMessage("Permite el acceso a la cámara."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);
  async function capture() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const session = biometricSession.current ?? await call("start");
      biometricSession.current = session;
      setMessage(
        `Desafío: ${session.challenge === "turn_left_then_center" ? "Gira ligeramente a la izquierda y vuelve al centro" : "Gira ligeramente a la derecha y vuelve al centro"}`,
      );
      const images = [];
      for (let i = 0; i < 3; i++) {
        setMessage(i === 1 ? (session.challenge === "turn_left_then_center" ? "Gira ligeramente a la izquierda" : "Gira ligeramente a la derecha") : "Mira al centro de la guía");
        await new Promise((r) => setTimeout(r, 1500));
        const source = video.current;
        if (!source?.videoWidth) throw new Error("Cámara no disponible.");
        const canvas = document.createElement("canvas");
        canvas.width = source.videoWidth;
        canvas.height = source.videoHeight;
        canvas.getContext("2d")?.drawImage(source, 0, 0);
        images.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      }
      const result = await call("evidence", {
        sessionId: session.id,
        images,
        mode,
        consent,
        evaluation: Boolean(evaluation),
        ...evaluation,
      });
      onResult?.(result);
      if (result.evaluation) { setMessage(result.capture_rejected ? `Captura rechazada: ${result.reason}. Ensayo guardado sin aceptación.` : `Ensayo guardado. Puntuación técnica: ${result.cosine_score ?? "enrolamiento"}. Duración: ${Math.round(result.latency_ms)} ms. No registra asistencia.`); return; }
      if (result.authorized === true && typeof result.grant === "string") {
        setOpen(false);
        onVerified?.(result.grant, result.cosine_score);
        return;
      }
      setMessage(
        `${result.cosine_score !== undefined ? `Puntuación técnica experimental: ${result.cosine_score.toFixed(4)}. ` : "Muestras de enrolamiento experimental guardadas. "}Verificación de vida pendiente: la confirmación de asistencia permanece bloqueada.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error de captura.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
      >
        Biometría facial
      </button>
      <Modal
        open={open}
        title="Verificación facial"
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-2xl bg-slate-950"><video
            ref={video}
            autoPlay
            muted
            playsInline
            className="aspect-square w-full rounded-xl bg-slate-950 object-cover"
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="h-[72%] w-[56%] rounded-[48%] border-4 border-white/90 shadow-[0_0_0_999px_rgba(15,23,42,.35)]" /></div></div>
          <p role="status" className="text-sm text-slate-700">
            {message || "Centra el rostro y mantén buena iluminación."}
          </p>
          {management ? <select
            aria-label="Operación biométrica"
            className="control-input"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as "enroll" | "verify")}
          >
            <option value="verify">Verificar rostro</option>
            <option value="enroll">
              Registrar / actualizar muestras de prueba
            </option>
          </select> : null}
          {management && mode === "enroll" ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />Confirmo el consentimiento del participante para este enrolamiento y su retención según la política biométrica.</label> : null}
          <button
            type="button"
            disabled={busy || (mode === "enroll" && !consent)}
            onClick={capture}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "Procesando…" : "Iniciar captura"}
          </button>
          {management ? <><button
            type="button"
            disabled={busy}
            onClick={async () => {
              try {
                const result = await call("status");
                setMessage(`Estado: ${result.status}`);
              } catch (e) {
                setMessage(String(e));
              }
            }}
            className="px-3 py-2 text-sm"
          >
            Consultar estado
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              try {
                await call("revoke");
                setMessage("Plantilla experimental revocada.");
              } catch (e) {
                setMessage(String(e));
              }
            }}
            className="px-3 py-2 text-sm text-rose-700"
          >
            Revocar plantilla de prueba
          </button></> : null}
        </div>
      </Modal>
    </div>
  );
}
