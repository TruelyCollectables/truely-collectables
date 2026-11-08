import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const BUCKET = "ebay-listing-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ListingSide = "front" | "back";

function cleanSku(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function cleanSide(value: string): ListingSide | null {
  return value === "front" || value === "back" ? value : null;
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function ensureBucket() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: bucket } = await supabase.storage.getBucket(BUCKET);

  if (!bucket) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_TYPES),
    });

    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw new Error(`Could not create eBay image bucket: ${error.message}`);
    }
  } else if (!bucket.public) {
    const { error } = await supabase.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_TYPES),
    });

    if (error) {
      throw new Error(`Could not make eBay image bucket public: ${error.message}`);
    }
  }

  return supabase;
}

function publicUrl(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  path: string,
) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sku = cleanSku(url.searchParams.get("sku") || "");

    if (!sku) {
      return NextResponse.json({ error: "SKU is required." }, { status: 400 });
    }

    const supabase = await ensureBucket();
    const { data, error } = await supabase.storage.from(BUCKET).list(sku, {
      limit: 20,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`Could not read listing images: ${error.message}`);
    }

    const files = Array.isArray(data) ? data : [];
    const front = files.find((file) =>
      /^front\.(jpg|jpeg|png|webp)$/i.test(file.name),
    );
    const back = files.find((file) =>
      /^back\.(jpg|jpeg|png|webp)$/i.test(file.name),
    );

    return NextResponse.json(
      {
        ok: true,
        sku,
        frontUrl: front ? publicUrl(supabase, `${sku}/${front.name}`) : null,
        backUrl: back ? publicUrl(supabase, `${sku}/${back.name}`) : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load eBay listing images.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const sku = cleanSku(String(formData.get("sku") || ""));
    const side = cleanSide(String(formData.get("side") || ""));
    const file = formData.get("file");

    if (!sku) {
      return NextResponse.json({ error: "SKU is required." }, { status: 400 });
    }
    if (!side) {
      return NextResponse.json(
        { error: "Image side must be front or back." },
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "An image file is required." },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Use a JPEG, PNG, or WebP image." },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image must be between 1 byte and 10 MB." },
        { status: 400 },
      );
    }

    const supabase = await ensureBucket();
    const extension = extensionFor(file.type);
    const existing = ["jpg", "jpeg", "png", "webp"]
      .filter((value) => value !== extension)
      .map((value) => `${sku}/${side}.${value}`);

    if (existing.length > 0) {
      await supabase.storage.from(BUCKET).remove(existing);
    }

    const objectPath = `${sku}/${side}.${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: true,
    });

    if (error) {
      throw new Error(`Image upload failed: ${error.message}`);
    }

    return NextResponse.json(
      {
        ok: true,
        sku,
        side,
        imageUrl: publicUrl(supabase, objectPath),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload listing image.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
