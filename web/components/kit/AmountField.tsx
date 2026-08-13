"use client";

import type { FormEvent, KeyboardEvent } from "react";
import "./kit.css";

export function AmountField({
  id,
  label,
  value,
  unit,
  placeholder = "0.00",
  error,
  maxDisabled = false,
  maxLabel = "MAX",
  onChange,
  onSubmit,
  onMax,
}: {
  id?: string;
  label: string;
  value: string;
  unit: string;
  placeholder?: string;
  error?: string;
  maxDisabled?: boolean;
  maxLabel?: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  onMax?: () => void;
}) {
  const invalid = Boolean(error);
  const inputId = id ?? "kit-amount";

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit?.();
    }
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit?.();
  }

  return (
    <form className="kit-amount-field" onSubmit={onFormSubmit} data-invalid={invalid ? "true" : "false"}>
      <label htmlFor={inputId}>{label}</label>
      <div className="kit-amount-line" data-invalid={invalid ? "true" : "false"}>
        <input
          id={inputId}
          value={value}
          placeholder={placeholder}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${inputId}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="kit-amount-unit">{unit}</span>
        <button type="button" className="kit-max" disabled={maxDisabled} onClick={onMax}>
          {maxLabel}
        </button>
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="kit-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
