"use client";

import Image from "next/image";
import { useState } from "react";
import {
  listingImageAltText,
  listingImageLabel,
} from "../../../lib/listing-image-utils";

export default function ProductGallery({
  title,
  images,
}: {
  title: string;
  images: string[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const safeIndex = selectedIndex >= 0 && selectedIndex < images.length
    ? selectedIndex
    : 0;
  const selectedImage = images[safeIndex] || "/placeholder.png";

  return (
    <section aria-label={`${title} photos`}>
      <figure className="overflow-hidden rounded border bg-white">
        <a
          href={selectedImage}
          target="_blank"
          rel="noreferrer"
          className="block"
          aria-label={`Open ${listingImageAltText(title, safeIndex)} full size`}
        >
          <div className="relative aspect-[3/4] bg-white">
            <Image
              src={selectedImage}
              alt={listingImageAltText(title, safeIndex)}
              fill
              priority
              unoptimized
              sizes="(min-width: 1024px) calc(100vw - 540px), 100vw"
              className="object-contain p-3"
            />
          </div>
        </a>
        <figcaption className="border-t px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-neutral-600">
          {listingImageLabel(safeIndex)}
        </figcaption>
      </figure>

      {images.length > 1 ? (
        <div
          className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6"
          aria-label="Choose listing photo"
        >
          {images.map((image, index) => {
            const selected = index === safeIndex;
            return (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setSelectedIndex(index)}
                aria-label={`Show ${listingImageAltText(title, index)}`}
                aria-pressed={selected}
                className={`rounded border bg-white p-1 ${
                  selected ? "border-neutral-950 ring-2 ring-neutral-950" : "border-neutral-300"
                }`}
              >
                <span className="relative block aspect-[3/4] bg-white">
                  <Image
                    src={image}
                    alt=""
                    fill
                    unoptimized
                    sizes="120px"
                    className="object-contain"
                  />
                </span>
                <span className="mt-1 block truncate text-[10px] font-bold uppercase text-neutral-600">
                  {listingImageLabel(index)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <p className="mt-3 text-sm text-neutral-500">
        {images.length} listing photo{images.length === 1 ? "" : "s"}. Select any thumbnail to inspect it, or open the main photo at full size.
      </p>
    </section>
  );
}
