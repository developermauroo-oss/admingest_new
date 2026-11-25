"use client";
import { useState } from "react";
import { lookupAttendanceEmployee } from "@/features/asistencia/server/actions";
import { SFaceCapture } from "./sface-capture";
type Employee = {
  id: string;
  name: string;
  stores: { id: string; name: string }[];
};
export function SFaceMarker() {
  const [document, setDocument] = useState("");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<{ grant: string; storeId: string; score: number } | null>(null);
  const [registered, setRegistered] = useState(false);
  async function confirm() {
    if (!employee || !verified || busy) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch("/api/asistencia/biometria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "confirm", personaId: employee.id, storeId: verified.storeId, grant: verified.grant, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setRegistered(true); setVerified(null); setMessage("Marcación registrada correctamente.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo registrar."); }
      finally { setBusy(false); }
    }, () => { setBusy(false); setMessage("Permite el acceso a la ubicación."); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  return (
    <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold">Marcador</h2>
      {registered ? <div role="status" className="rounded-xl bg-emerald-50 p-5 text-emerald-900">Marcación confirmada<button type="button" className="mt-4 block text-sm" onClick={() => { setEmployee(null); setRegistered(false); setMessage(""); }}>Nueva marcación</button></div> : verified && employee ? <div className="space-y-4"><h3 className="text-lg font-semibold">{employee.name}</h3><p>Puntuación técnica: {verified.score.toFixed(4)}</p><p className="text-sm text-emerald-700">Identidad y prueba de vida validadas.</p><button type="button" onClick={confirm} disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-3 text-white disabled:opacity-50">Confirmar marcación</button></div> : !employee ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await lookupAttendanceEmployee({
                documentType: "dni",
                document,
              });
              if (!result.ok) setMessage(result.message);
              else setEmployee(result.employee);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="text-sm">
            DNI
            <input
              className="control-input my-3"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              placeholder="Número de documento"
            />
          </label>
          <button
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-white"
          >
            Buscar empleado
          </button>
        </form>
      ) : (
        <>
          <p className="text-sm">Verifica el rostro para continuar.</p>
          {employee.stores.map((store) => (
            <div key={store.id}>
              <p className="mb-2 text-sm text-slate-500">{store.name}</p>
              <SFaceCapture
                personaId={employee.id}
                storeId={store.id}
                autoOpen={employee.stores.length === 1}
                onVerified={(grant, score) => setVerified({ grant, score, storeId: store.id })}
              />
            </div>
          ))}
          <button
            className="text-sm text-indigo-700"
            onClick={() => { setEmployee(null); setVerified(null); }}
          >
            Buscar otro empleado
          </button>
        </>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
