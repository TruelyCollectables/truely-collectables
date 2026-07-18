"use client";

import { useFormStatus } from "react-dom";

export default function AdminSubmitButton({
  children,
  className,
  disabled = false,
  disabledReason,
  pendingChildren = "Working...",
  title,
}: {
  children: React.ReactNode;
  className: string;
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  pendingChildren?: React.ReactNode;
  title?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <>
      <button
        type="submit"
        aria-busy={pending}
        disabled={isDisabled}
        title={title}
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
