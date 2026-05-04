'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface FormErrors {
  general?: string;
  fields?: Record<string, string>;
}

export function ApplicationForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = {
      cedula: String(formData.get('cedula') ?? ''),
      ingresos: Number(formData.get('ingresos')),
      monto: Number(formData.get('monto')),
      plazo: Number(formData.get('plazo')),
    };

    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrors({
          general:
            body.error === 'invalid_input'
              ? 'Algún campo no cumple las reglas de validación.'
              : 'No se pudo procesar la solicitud.',
        });
        setSubmitting(false);
        return;
      }

      const json = await response.json();
      router.push(`/applications/${json.applicationId}`);
    } catch {
      setErrors({ general: 'Error de red. Intentá de nuevo.' });
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      noValidate
      data-testid="application-form"
    >
      <div className="space-y-2">
        <label htmlFor="cedula" className="eyebrow">
          Cédula
        </label>
        <input
          id="cedula"
          name="cedula"
          required
          inputMode="numeric"
          pattern="\d{10}"
          autoComplete="off"
          placeholder="1712345678"
          className="block w-full rounded-md border border-[var(--rule-strong)] bg-[var(--bg-elevated)] px-4 py-3 text-[var(--fg)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="ingresos" className="eyebrow">
          Ingresos mensuales (USD)
        </label>
        <input
          id="ingresos"
          name="ingresos"
          type="number"
          required
          min={1}
          step={1}
          placeholder="1500"
          className="block w-full rounded-md border border-[var(--rule-strong)] bg-[var(--bg-elevated)] px-4 py-3 text-[var(--fg)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="monto" className="eyebrow">
            Monto solicitado (USD)
          </label>
          <input
            id="monto"
            name="monto"
            type="number"
            required
            min={100}
            max={50000}
            step={1}
            placeholder="3000"
            className="block w-full rounded-md border border-[var(--rule-strong)] bg-[var(--bg-elevated)] px-4 py-3 text-[var(--fg)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="plazo" className="eyebrow">
            Plazo (meses)
          </label>
          <input
            id="plazo"
            name="plazo"
            type="number"
            required
            min={1}
            max={60}
            step={1}
            placeholder="24"
            className="block w-full rounded-md border border-[var(--rule-strong)] bg-[var(--bg-elevated)] px-4 py-3 text-[var(--fg)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>
      </div>

      {errors.general && (
        <p
          role="alert"
          className="text-sm text-[#B64545]"
          data-testid="form-error"
        >
          {errors.general}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="submit-button"
      >
        {submitting ? 'Procesando...' : 'Procesar solicitud'}
      </button>
    </form>
  );
}
