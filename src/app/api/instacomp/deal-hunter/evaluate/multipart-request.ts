import { NextRequest } from "next/server";

export type DealHunterMultipartInput = {
  listingJson: string;
  listing: Record<string, any>;
  front: File;
  back: File;
};

export async function parseDealHunterMultipartRequest(
  request: Request,
): Promise<DealHunterMultipartInput> {
  const form = await request.formData();
  const listingJson = form.get("listingJson");
  const front = form.get("frontImage");
  const back = form.get("backImage");
  if (typeof listingJson !== "string") throw new Error("listingJson is required.");
  if (!(front instanceof File) || !(back instanceof File)) {
    throw new Error("Both frontImage and backImage are required.");
  }
  return {
    listingJson,
    listing: JSON.parse(listingJson) as Record<string, any>,
    front,
    back,
  };
}
export function replayDealHunterMultipartRequest(
  request: Request,
  input: DealHunterMultipartInput,
) {
  const form = new FormData();
  form.set("listingJson", input.listingJson);
  form.set("frontImage", input.front, input.front.name || "front.jpg");
  form.set("backImage", input.back, input.back.name || "back.jpg");

  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");

  return new NextRequest(request.url, {
    method: "POST",
    headers,
    body: form,
  });
}