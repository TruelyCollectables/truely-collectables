"use client";

import { useFormStatus } from "react-dom";

export default function AdminSubmitButton({
  children,
  className,
  disabled = false,
  pendingChildren = "Working...",
  title,
}: {
  children: React.ReactNode;
  className: string;
  disabled?: boolean;
  pendingChildren?: React.ReactNode;
  title?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
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
  );
}
