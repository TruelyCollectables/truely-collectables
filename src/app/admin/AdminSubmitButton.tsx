"use client";

import { useFormStatus } from "react-dom";

export default function AdminSubmitButton({
  children,
  className,
  disabled = false,
  disabledReason,
  name,
  pendingChildren = "Working...",
  title,
  value,
}: {
  children: React.ReactNode;
  className: string;
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  name?: string;
  pendingChildren?: React.ReactNode;
  title?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <>
      <button
        type="submit"
        aria-busy={pending}
        disabled={isDisabled}
        name={name}
        title={title}
        value={value}
        className={`${className} disabled:opacity-60 ${
          pending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"
        }`}
      >
        {pending ? pendingChildren : children}
      </button>
      {disabled && !pending && disabledReason ? (
        <p role="status" aria-live="polite" className="mt-2 text-xs font-bold">
          {disabledReason}
        </p>
      ) : null}
    </>
  );
}
