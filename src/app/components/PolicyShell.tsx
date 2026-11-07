import type { ReactNode } from "react";

export default function PolicyShell(props: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <header className="border-2 border-neutral-950 bg-yellow-300 p-6 shadow-[6px_6px_0_#111318] sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-700">
          {props.eyebrow}
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
          {props.title}
        </h1>
        {props.updated ? (
          <p className="mt-3 text-sm font-bold text-neutral-700">
            Last updated: {props.updated}
          </p>
        ) : null}
      </header>

      <div className="mt-10 space-y-8 text-base leading-7 text-neutral-800">
        {props.children}
      </div>
    </main>
  );
}
