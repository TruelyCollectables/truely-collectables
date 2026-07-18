"use client";

export default function PrintPackingSlipButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
    >
      Print Packing Slip
    </button>
  );
}
