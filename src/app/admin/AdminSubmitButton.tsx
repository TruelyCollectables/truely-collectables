"use client";

import { useFormStatus } from "react-dom";

export default function AdminSubmitButton({
  children,
  className,
  pendingChildren = "Working...",
}: {
  children: React.ReactNode;
  className: string;
  pendingChildren?: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      aria-busy={pending}
      disabled={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {pending ? pendingChildren : children}
    </button>
  );
}
