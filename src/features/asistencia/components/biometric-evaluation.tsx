"use client";
import { useState } from "react";
import { SFaceCapture } from "./sface-capture";
type Row = {
  result?: { mode?: string; capture_rejected?: boolean; process_cpu_ms?: number; working_set_bytes?: number };
  kind: string;
  cosine_score: number | null;
  pad_score: number | null;
  latency_ms: number | null;
  created_at: string;
};
export function BiometricEvaluation({
  options,
}: {
  options: { personId: string; storeId: string; label: string }[];
}) {
  const [selected, setSelected] = useState("0");
  const [kind, setKind] = useState("genuine");
  const [lighting, setLighting] = useState("Interior iluminado");
  const [device, setDevice] = useState("Cámara de este equipo");
  const [threshold, setThreshold] = useState(0.5);
  const [padThreshold, setPadThreshold] = useState(0.9);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const person = options[Number(selected)];
  async function report() {
    if (!person) return;
    try {
      const response = await fetch("/api/asistencia/biometria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "reports",
          personaId: person.personId,
          storeId: person.storeId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setRows(result.rows);
    } catch (error) {
      setMessage(String(error));
    }
  }
  function rate(items: Row[], predicate: (row: Row) => boolean) {
    return items.length
      ? `${((100 * items.filter(predicate).length) / items.length).toFixed(2)} % (${items.length} ensayos)`
      : "Sin muestra suficiente";
  }
  const genuine = rows.filter(
    (row) => row.kind === "genuine" && row.result?.mode === "verify",
  );
  const impostors = rows.filter(
    (row) => row.kind === "impostor" && row.result?.mode === "verify",
  );
  const attacks = rows.filter(
    (row) =>
      ["photo", "screen", "video"].includes(row.kind) && row.pad_score !== null,
  );
  const live = rows.filter(
    (row) => row.kind === "genuine" && row.pad_score !== null,
  );
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-xl font-semibold">Evaluación biométrica</h2>
        <p className="mt-2 text-sm text-slate-600">
          Ensayos aislados de asistencia. Los resultados observados no
          garantizan precisión poblacional. La aceptación operativa permanece
          desactivada hasta evaluar PAD y calibración.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label>
            Participante y tienda
            <select
              aria-label="Participante y tienda"
              className="control-input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {options.map((option, index) => (
                <option
                  key={`${option.personId}-${option.storeId}`}
                  value={index}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de ensayo
            <select
              className="control-input"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="genuine">Genuino</option>
              <option value="impostor">Impostor</option>
              <option value="photo">Fotografía impresa</option>
              <option value="screen">Pantalla</option>
              <option value="video">Vídeo</option>
            </select>
          </label>
          <label>
            Iluminación
            <input
              className="control-input"
              value={lighting}
              onChange={(e) => setLighting(e.target.value)}
            />
          </label>
          <label>
            Dispositivo
            <input
              className="control-input"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4">
          {person ? (
            <SFaceCapture
              key={`${person.personId}-${person.storeId}-${kind}`}
              personaId={person.personId}
              storeId={person.storeId}
              management
              evaluation={{ kind, lighting, device }}
              onResult={() => void report()}
            />
          ) : (
            <p>No hay participantes activos asignados a tiendas.</p>
          )}
        </div>
        <p role="status">{message}</p>
      </section>
      <section className="rounded-2xl border bg-white p-6">
        <h3 className="font-semibold">Métricas observadas</h3>
        <div className="my-4 flex flex-wrap gap-3">
          <label>
            Umbral coseno
            <input
              aria-label="Umbral coseno"
              type="number"
              min="-1"
              max="1"
              step="0.01"
              className="control-input"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
          <label>
            Umbral PAD
            <input
              aria-label="Umbral PAD"
              type="number"
              min="0"
              max="1"
              step="0.01"
              className="control-input"
              value={padThreshold}
              onChange={(e) => setPadThreshold(Number(e.target.value))}
            />
          </label>
        </div>
        <p>FAR: {rate(impostors, (row) => row.cosine_score !== null && row.cosine_score >= threshold)}</p>
        <p>FRR: {rate(genuine, (row) => row.cosine_score === null || row.cosine_score < threshold)}</p>
        <p>APCER: {rate(attacks, (row) => row.pad_score! >= padThreshold)}</p>
        <p>BPCER: {rate(live, (row) => row.pad_score! < padThreshold)}</p>
        <p className="mt-2 text-sm">
          Escala prevista: 95–100 satisfactorio; 90–94 reforzada; 80–89
          recapturar; menos de 80 rechazar. No se aplica hasta calibración.
        </p>
        <button className="mt-4 rounded-lg border px-4 py-2" onClick={report}>
          Actualizar reporte
        </button>
        <button
          className="ml-2 rounded-lg border px-4 py-2"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob(
                [
                  JSON.stringify(
                    { rows, threshold, padThreshold, operational: false },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              ),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "evaluacion-biometrica.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Exportar reporte JSON
        </button>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ensayo</th>
                <th>Coseno</th>
                <th>PAD</th>
                <th>Latencia</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{new Date(row.created_at).toLocaleString("es-PE")}</td>
                  <td>{row.kind}</td>
                  <td>{row.cosine_score?.toFixed(4) ?? "—"}</td>
                  <td>{row.pad_score?.toFixed(4) ?? "No configurado"}</td>
                  <td>{row.latency_ms?.toFixed(0)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
