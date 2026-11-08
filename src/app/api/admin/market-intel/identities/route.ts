import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

function slug(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const subjectId = text(formData, "subjectId");
    const seasonYear = text(formData, "seasonYear");
    const manufacturer = text(formData, "manufacturer");
    const productLine = text(formData, "productLine");
    const setName = text(formData, "setName");
    const insertName = text(formData, "insertName");
    const cardNumber = text(formData, "cardNumber");
    const parallelName = text(formData, "parallelName") || "Base";
    const variationName = text(formData, "variationName");
    const conditionType = text(formData, "conditionType") || "raw";
    const gradingCompany = text(formData, "gradingCompany");
    const grade = text(formData, "grade");
    const serialRaw = text(formData, "serialNumberedTo");
    const serialNumberedTo = serialRaw ? Number(serialRaw) : null;

    if (!subjectId || !seasonYear || !manufacturer || !cardNumber) {
      throw new Error("Player, year, manufacturer, and card number are required.");
    }
    if (serialNumberedTo !== null && (!Number.isInteger(serialNumberedTo) || serialNumberedTo <= 0)) {
      throw new Error("Serial numbering must be a positive whole number.");
    }
    if (conditionType === "graded" && (!gradingCompany || !grade)) {
      throw new Error("Graded cards require a grading company and grade.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: subject, error: subjectError } = await supabase
      .from("tcos_mi_subjects")
      .select("id,name,sport_or_category")
      .eq("id", subjectId)
      .single();
    if (subjectError) throw new Error(subjectError.message);

    const conditionLabel =
      conditionType === "graded"
        ? `${gradingCompany} ${grade}`
        : conditionType.replaceAll("_", " ");
    const productLabel = insertName || setName || productLine;
    const displayName = [
      seasonYear,
      manufacturer,
      productLine,
      productLabel && productLabel !== productLine ? productLabel : null,
      subject.name,
      `#${cardNumber}`,
      parallelName !== "Base" ? parallelName : null,
      variationName || null,
      serialNumberedTo ? `/${serialNumberedTo}` : null,
      conditionLabel,
    ]
      .filter(Boolean)
      .join(" — ");

    const identityKey = [
      "sports-card",
      subject.name,
      seasonYear,
      manufacturer,
      productLine,
      setName,
      insertName,
      cardNumber,
      parallelName,
      variationName,
      serialNumberedTo ? String(serialNumberedTo) : "unnumbered",
      formData.get("autograph") === "on" ? "auto" : "no-auto",
      formData.get("memorabilia") === "on" ? "memorabilia" : "no-memorabilia",
      conditionType,
      gradingCompany,
      grade,
    ]
      .map(slug)
      .join("|");

    const { data: existing, error: lookupError } = await supabase
      .from("tcos_mi_collectible_identities")
      .select("id")
      .eq("identity_key", identityKey)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    let identityId = existing?.id as string | undefined;
    if (!identityId) {
      const { data, error } = await supabase
        .from("tcos_mi_collectible_identities")
        .insert({
          subject_id: subjectId,
          collectible_type: "sports_card",
          sport_or_category: subject.sport_or_category,
          season_year: seasonYear,
          manufacturer,
          brand: text(formData, "brand") || manufacturer,
          product_line: productLine || null,
          set_name: setName || null,
          insert_name: insertName || null,
          card_number: cardNumber,
          parallel_name: parallelName,
          variation_name: variationName || null,
          serial_numbered_to: serialNumberedTo,
          autograph: formData.get("autograph") === "on",
          memorabilia: formData.get("memorabilia") === "on",
          rookie_designation: formData.get("rookieDesignation") === "on",
          condition_type: conditionType,
          grading_company: conditionType === "graded" ? gradingCompany : null,
          grade: conditionType === "graded" ? grade : null,
          identity_key: identityKey,
          display_name: displayName,
          identity_confidence: 100,
          active: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      identityId = data.id;
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${identityId}?saved=identity`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create identity.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
