function sanitizePdfText(value: string): string {
  return value
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrapLine(line: string, maxLength = 94): string[] {
  if (line.length <= maxLength) return [line];

  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length > maxLength) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }

  if (current) lines.push(current);

  return lines.flatMap((wrapped) => {
    if (wrapped.length <= maxLength) return [wrapped];

    const chunks: string[] = [];

    for (let index = 0; index < wrapped.length; index += maxLength) {
      chunks.push(wrapped.slice(index, index + maxLength));
    }

    return chunks;
  });
}

function paginate(text: string): string[][] {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines = rawLines.flatMap((line) => wrapLine(line));
  const pages: string[][] = [];
  const linesPerPage = 58;

  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }

  return pages.length ? pages : [["No report content."]];
}

function pageContent(lines: string[], pageNumber: number, totalPages: number) {
  const commands = [
    "BT",
    "/F1 9 Tf",
    "50 750 Td",
    "12 TL",
  ];

  for (const line of lines) {
    commands.push(`(${sanitizePdfText(line)}) Tj`);
    commands.push("T*");
  }

  commands.push("T*");
  commands.push(`(Page ${pageNumber} of ${totalPages}) Tj`);
  commands.push("ET");

  return commands.join("\n");
}

export function createEvidencePdf(reportText: string): Buffer {
  const pages = paginate(reportText);
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
  );

  pages.forEach((lines, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const content = pageContent(lines, index + 1, pages.length);

    objects.push(
      [
        "<<",
        "/Type /Page",
        "/Parent 2 0 R",
        "/MediaBox [0 0 612 792]",
        "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>",
        `/Contents ${contentObjectId} 0 R`,
        ">>",
      ].join("\n"),
    );

    objects.push(
      `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "ascii");

  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "ascii");
}
