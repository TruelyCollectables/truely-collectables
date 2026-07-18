"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type MissingField = {
  label: string;
  element: HTMLInputElement | HTMLSelectElement | null;
};

function textValue(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
    return field.value.trim();
  }
  return "";
}

function checked(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement && field.type === "checkbox" && field.checked;
}

function fieldElement(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement || field instanceof HTMLSelectElement
    ? field
    : null;
}

function missingApprovalFields(form: HTMLFormElement): MissingField[] {
  const missing: MissingField[] = [];
  const requiredTextFields = [
    ["seasonYear", "Year"],
    ["manufacturer", "Manufacturer"],
    ["productLine", "Product line"],
    ["cardNumber", "Exact card number"],
  ] as const;

  for (const [name, label] of requiredTextFields) {
    if (!textValue(form, name)) {
      missing.push({ label, element: fieldElement(form, name) });
    }
  }

  const quantity = Number(textValue(form, "quantity"));
  if (!Number.isInteger(quantity) || quantity <= 0) {
    missing.push({ label: "Positive whole-number quantity", element: fieldElement(form, "quantity") });
  }

  if (textValue(form, "conditionType") === "graded") {
    if (!textValue(form, "gradingCompany")) {
      missing.push({ label: "Grading company", element: fieldElement(form, "gradingCompany") });
    }
    if (!textValue(form, "grade")) {
      missing.push({ label: "Grade", element: fieldElement(form, "grade") });
    }
  }

  const parallel = textValue(form, "parallelName").toLowerCase();
  const serial = Number(textValue(form, "serialNumberedTo"));
  const hasNonBaseSignal = Boolean(
    (parallel && parallel !== "base") ||
      textValue(form, "insertName") ||
      textValue(form, "variationName") ||
      (Number.isInteger(serial) && serial > 0) ||
      checked(form, "autograph") ||
      checked(form, "memorabilia"),
  );

  if (!hasNonBaseSignal) {
    missing.push({
      label: "A real non-base signal: parallel, insert, variation, serial numbering, autograph, or memorabilia",
      element:
        fieldElement(form, "parallelName") ||
        fieldElement(form, "insertName") ||
        fieldElement(form, "variationName"),
    });
  }

  return missing;
}

function candidateNumber(form: HTMLFormElement) {
  const match = form.action.match(/\/discovery\/([^/]+)\/approve/i);
  return match?.[1] || "candidate";
}

export default function DiscoveryReviewEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/admin/market-intel/discovery") return;

    const cleanups: Array<() => void> = [];
    const approvalForms = Array.from(
      document.querySelectorAll<HTMLFormElement>(
        'form[action*="/api/admin/market-intel/discovery/"][action*="/approve"]',
      ),
    );

    for (const form of approvalForms) {
      if (form.dataset.discoveryEnhanced === "1") continue;
      form.dataset.discoveryEnhanced = "1";
      form.noValidate = true;

      const candidateId = candidateNumber(form);
      form.id = `approve-${candidateId}`;

      const parallelField = fieldElement(form, "parallelName");
      if (parallelField instanceof HTMLInputElement) {
        parallelField.required = false;
        parallelField.placeholder =
          parallelField.placeholder || "Base/blank is okay for an insert, auto, numbered card, or variation";
      }

      const panel = document.createElement("section");
      panel.className =
        "mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");

      const heading = document.createElement("p");
      heading.className = "text-sm font-black";
      const detail = document.createElement("p");
      detail.className = "mt-1 text-xs font-bold leading-5";
      panel.append(heading, detail);
      form.parentElement?.insertBefore(panel, form);

      const actionBar = document.createElement("div");
      actionBar.className = "mb-4 flex flex-wrap gap-2";
      const focusButton = document.createElement("button");
      focusButton.type = "button";
      focusButton.className =
        "rounded-md bg-emerald-700 px-4 py-2 text-sm font-black text-white";
      focusButton.textContent = "REVIEW & APPROVE";
      focusButton.addEventListener("click", () => {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => {
          const first = missingApprovalFields(form)[0]?.element;
          first?.focus();
        }, 300);
      });

      const rejectForm = form.parentElement?.querySelector<HTMLFormElement>(
        'form[action*="/reject"]',
      );
      const rejectButton = document.createElement("button");
      rejectButton.type = "button";
      rejectButton.className =
        "rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-black text-rose-950";
      rejectButton.textContent = "REJECT / REMOVE";
      rejectButton.addEventListener("click", () =>
        rejectForm?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      actionBar.append(focusButton, rejectButton);
      form.parentElement?.insertBefore(actionBar, panel);

      const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const fields = Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select"),
      );

      const update = (submitAttempt = false) => {
        for (const field of fields) {
          field.removeAttribute("aria-invalid");
          field.classList.remove("border-rose-500", "bg-rose-50");
        }

        const missing = missingApprovalFields(form);
        for (const item of missing) {
          item.element?.setAttribute("aria-invalid", "true");
          item.element?.classList.add("border-rose-500", "bg-rose-50");
        }

        if (missing.length === 0) {
          panel.className =
            "mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950";
          heading.textContent = "READY TO APPROVE";
          detail.textContent =
            "The exact-card fields are complete. Approving creates the exact identity, saves the live listing, and scores the deal. It does not purchase the card.";
          if (submitButton) submitButton.title = "Approve this exact identity and score its live listing.";
          return;
        }

        panel.className = submitAttempt
          ? "mb-4 rounded-lg border-2 border-rose-500 bg-rose-50 p-4 text-rose-950"
          : "mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950";
        heading.textContent = submitAttempt
          ? "APPROVAL STOPPED — COMPLETE THESE FIELDS"
          : `${missing.length} ITEM${missing.length === 1 ? "" : "S"} NEEDED BEFORE APPROVAL`;
        detail.textContent = missing.map((item) => item.label).join(" • ");
        if (submitButton) {
          submitButton.title = `Complete: ${missing.map((item) => item.label).join(", ")}`;
        }
      };

      const onInput = () => update(false);
      const onSubmit = (event: SubmitEvent) => {
        const missing = missingApprovalFields(form);
        if (missing.length === 0) return;
        event.preventDefault();
        update(true);
        panel.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => missing[0]?.element?.focus(), 300);
      };

      for (const field of fields) {
        field.addEventListener("input", onInput);
        field.addEventListener("change", onInput);
      }
      form.addEventListener("submit", onSubmit);
      update(false);

      cleanups.push(() => {
        for (const field of fields) {
          field.removeEventListener("input", onInput);
          field.removeEventListener("change", onInput);
          field.removeAttribute("aria-invalid");
          field.classList.remove("border-rose-500", "bg-rose-50");
        }
        form.removeEventListener("submit", onSubmit);
        delete form.dataset.discoveryEnhanced;
        form.removeAttribute("id");
        panel.remove();
        actionBar.remove();
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname]);

  return null;
}
