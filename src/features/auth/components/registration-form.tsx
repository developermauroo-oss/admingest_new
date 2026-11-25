"use client";

import { useState, useTransition, type ReactNode } from "react";
import { requestAuthorizedRegistration } from "@/features/auth/server/actions";

const MIN_PASSWORD = 12;

const documentTypes = [
  { value: "DNI", label: "DNI", placeholder: "8 dígitos", inputMode: "numeric" as const },
  {
    value: "CE",
    label: "Carné de extranjería",
    placeholder: "Número de carné",
    inputMode: "text" as const,
  },
  {
    value: "PASSPORT",
    label: "Pasaporte",
    placeholder: "Número de pasaporte",
    inputMode: "text" as const,
  },
];

/* ---------- Piezas pequeñas ---------- */

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {label}
      </label>
      {children}
      {hint && <div className="text-xs">{hint}</div>}
    </div>
  );
}

function EyeButton({
  visible,
  onToggle,
  label,
}: {
  visible: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
      aria-pressed={visible}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {visible ? (
          <>
            <path d="M3 3l18 18" />
            <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12 12 0 0 1-2.2 3M6.5 6.8C4.3 8.2 2.9 10.4 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.6-.8" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </>
        ) : (
          <>
            <path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}

function strength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= MIN_PASSWORD) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  const labels = ["Muy débil", "Débil", "Aceptable", "Buena", "Fuerte"];
  return { score, label: labels[score] };
}

const strengthColor = [
  "bg-rose-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
];

/* ---------- Formulario ---------- */

export function RegistrationForm() {
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [documentType, setDocumentType] = useState("DNI");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();

  const docMeta =
    documentTypes.find((d) => d.value === documentType) ?? documentTypes[0];
  const pwd = strength(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const matches = confirm.length > 0 && password === confirm;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setMessage("");
    setOk(null);
    start(async () => {
      const result = await requestAuthorizedRegistration({
        documentType: f.get("documentType"),
        documento: f.get("documento"),
        email: f.get("email"),
        password: f.get("password"),
        confirm: f.get("confirm"),
      });
      setMessage(result.message);
      setOk(result.ok);
      if (result.ok) {
        form.reset();
        setDocumentType("DNI");
        setPassword("");
        setConfirm("");
        setShowPassword(false);
        setShowConfirm(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
      {/* Resultado */}
      {message && (
        <div
          role={ok ? "status" : "alert"}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
            ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {ok ? (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5M12 16h.01" />
              </>
            )}
          </svg>
          <p>{message}</p>
        </div>
      )}

      {/* Identificación */}
      <fieldset className="space-y-4" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold text-slate-800">
          Identificación
        </legend>
        <div className="grid gap-4 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <Field label="Tipo de documento" htmlFor="documentType">
              <select
                id="documentType"
                required
                name="documentType"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="control-input w-full"
              >
                {documentTypes.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="Número de documento" htmlFor="documento">
              <input
                id="documento"
                required
                name="documento"
                inputMode={docMeta.inputMode}
                autoComplete="off"
                placeholder={docMeta.placeholder}
                className="control-input w-full"
              />
            </Field>
          </div>
        </div>
        <Field label="Correo institucional" htmlFor="email">
          <input
            id="email"
            required
            name="email"
            type="email"
            autoComplete="email"
            placeholder="nombre@empresa.com"
            className="control-input w-full"
          />
        </Field>
      </fieldset>

      {/* Seguridad */}
      <fieldset className="space-y-4" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold text-slate-800">
          Seguridad
        </legend>

        <Field
          label="Contraseña"
          htmlFor="password"
          hint={
            password ? (
              <div className="space-y-1.5">
                <div className="flex gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full ${
                        pwd.score >= i ? strengthColor[pwd.score] : "bg-slate-200"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-slate-500">
                  Seguridad: <span className="font-medium">{pwd.label}</span>
                  {password.length < MIN_PASSWORD &&
                    ` · faltan ${MIN_PASSWORD - password.length} caracteres`}
                </p>
              </div>
            ) : (
              <span className="text-slate-400">
                Mínimo {MIN_PASSWORD} caracteres.
              </span>
            )
          }
        >
          <div className="relative">
            <input
              id="password"
              required
              name="password"
              type={showPassword ? "text" : "password"}
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="control-input w-full !pr-12"
            />
            <EyeButton
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              label="contraseña"
            />
          </div>
        </Field>

        <Field
          label="Confirmar contraseña"
          htmlFor="confirm"
          hint={
            mismatch ? (
              <span className="text-rose-600">Las contraseñas no coinciden.</span>
            ) : matches ? (
              <span className="text-emerald-600">Las contraseñas coinciden.</span>
            ) : null
          }
        >
          <div className="relative">
            <input
              id="confirm"
              required
              name="confirm"
              type={showConfirm ? "text" : "password"}
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch}
              className="control-input w-full !pr-12"
            />
            <EyeButton
              visible={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
              label="confirmación de contraseña"
            />
          </div>
        </Field>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeWidth="3"
              className="opacity-25"
            />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        )}
        {pending ? "Enviando solicitud..." : "Solicitar acceso"}
      </button>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
        <svg
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <p>
          Al enviarla, tu solicitud quedará pendiente de verificación por un
          Owner. No se enviará correo.
        </p>
      </div>
    </form>
  );
}