"use client";

import { useMemo, useState } from "react";

export type PurchaseCostEntryMode = "lot_total" | "per_item";

type PurchaseCostEditorProps = {
  defaultQuantity?: number;
  defaultItemSubtotal?: number;
  defaultInboundShipping?: number;
  defaultSalesTax?: number;
  defaultBuyerFees?: number;
  defaultOtherCost?: number;
  defaultMode?: PurchaseCostEntryMode;
  quantityName?: string;
  className?: string;
};

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 font-semibold outline-none focus:border-black";

function safeNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function PurchaseCostEditor({
  defaultQuantity = 1,
  defaultItemSubtotal = 0,
  defaultInboundShipping = 0,
  defaultSalesTax = 0,
  defaultBuyerFees = 0,
  defaultOtherCost = 0,
  defaultMode = "lot_total",
  quantityName = "quantity",
  className = "",
}: PurchaseCostEditorProps) {
  const startingQuantity = Math.max(1, Math.round(safeNumber(defaultQuantity)));
  const [mode, setMode] = useState<PurchaseCostEntryMode>(defaultMode);
  const [quantity, setQuantity] = useState(startingQuantity);
  const [itemAmount, setItemAmount] = useState(
    defaultMode === "per_item"
      ? safeNumber(defaultItemSubtotal) / startingQuantity
      : safeNumber(defaultItemSubtotal),
  );
  const [shipping, setShipping] = useState(safeNumber(defaultInboundShipping));
  const [tax, setTax] = useState(safeNumber(defaultSalesTax));
  const [buyerFees, setBuyerFees] = useState(safeNumber(defaultBuyerFees));
  const [otherCost, setOtherCost] = useState(safeNumber(defaultOtherCost));

  const totals = useMemo(() => {
    const normalizedQuantity = Math.max(1, Math.round(quantity || 1));
    const itemSubtotal =
      mode === "per_item" ? itemAmount * normalizedQuantity : itemAmount;
    const lotTotal = itemSubtotal + shipping + tax + buyerFees + otherCost;
    const perItem = lotTotal / normalizedQuantity;

    return {
      quantity: normalizedQuantity,
      itemSubtotal,
      lotTotal,
      perItem,
    };
  }, [buyerFees, itemAmount, mode, otherCost, quantity, shipping, tax]);

  function switchMode(nextMode: PurchaseCostEntryMode) {
    if (nextMode === mode) return;

    if (nextMode === "per_item") {
      setItemAmount(totals.itemSubtotal / totals.quantity);
    } else {
      setItemAmount(totals.itemSubtotal);
    }
    setMode(nextMode);
  }

  return (
    <div className={className}>
      <input type="hidden" name="pricingMode" value={mode} />
      <input type="hidden" name="itemSubtotal" value={totals.itemSubtotal.toFixed(2)} />
      <input
        type="hidden"
        name="totalAcquisitionCost"
        value={totals.lotTotal.toFixed(2)}
      />
      <input type="hidden" name="unitCostBasis" value={totals.perItem.toFixed(2)} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-black">
          Cost entry method
          <select
            value={mode}
            onChange={(event) => switchMode(event.target.value as PurchaseCostEntryMode)}
            className={inputClass}
          >
            <option value="lot_total">I know the total item price for the lot</option>
            <option value="per_item">I know what I paid per item</option>
          </select>
        </label>

        <label className="text-sm font-black">
          Quantity in this lot
          <input
            name={quantityName}
            type="number"
            min="1"
            step="1"
            required
            value={quantity}
            onChange={(event) =>
              setQuantity(Math.max(1, Math.round(safeNumber(event.target.value))))
            }
            className={inputClass}
          />
        </label>

        <label className="text-sm font-black md:col-span-2">
          {mode === "per_item" ? "Item price per card/item" : "Item subtotal for the entire lot"}
          <input
            name="itemAmount"
            type="number"
            min="0"
            step="0.01"
            required
            value={itemAmount}
            onChange={(event) => setItemAmount(safeNumber(event.target.value))}
            className={inputClass}
          />
        </label>

        <MoneyInput
          name="inboundShipping"
          label="Shipping for the entire lot"
          value={shipping}
          onChange={setShipping}
        />
        <MoneyInput
          name="salesTax"
          label="Sales tax for the entire lot"
          value={tax}
          onChange={setTax}
        />
        <MoneyInput
          name="buyerFees"
          label="Buyer fees for the entire lot"
          value={buyerFees}
          onChange={setBuyerFees}
        />
        <MoneyInput
          name="otherCost"
          label="Other cost / trade value"
          value={otherCost}
          onChange={setOtherCost}
        />
      </div>

      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Item subtotal" value={money(totals.itemSubtotal)} />
        <Summary label="Total paid for lot" value={money(totals.lotTotal)} strong />
        <Summary label="Quantity" value={String(totals.quantity)} />
        <Summary label="All-in cost per item" value={money(totals.perItem)} strong />
      </section>

      <p className="mt-3 text-xs font-bold leading-5 text-neutral-600">
        TCOS stores the total cost of the complete lot, then divides that total by quantity to
        calculate the all-in cost basis for each card or item. Shipping, tax, fees, and other
        acquisition costs are included in the per-item number.
      </p>
    </div>
  );
}

function MoneyInput({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input
        name={name}
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(safeNumber(event.target.value))}
        className={inputClass}
      />
    </label>
  );
}

function Summary({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "rounded-lg border border-emerald-300 bg-emerald-50 p-4"
          : "rounded-lg border border-neutral-200 bg-neutral-50 p-4"
      }
    >
      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
