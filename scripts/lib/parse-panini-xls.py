#!/usr/bin/env python3
import json
import math
import re
import sys
from pathlib import Path

import xlrd

REQUIRED_HEADERS = ("CARD #", "CARD SET", "ATHLETE", "TEAM")
OPTIONAL_HEADERS = ("POSITION", "SEQUENCE")


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def header_name(value):
    text = clean(value).upper().replace("NUMBER", "#")
    text = re.sub(r"\s*#\s*", " #", text)
    return text.strip()


def cell_text(cell):
    value = cell.value
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        number = float(value)
        if math.isfinite(number) and number.is_integer():
            return str(int(number))
        return ("%.12g" % number).strip()
    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return ""
    return clean(value)


def find_header(sheet):
    limit = min(sheet.nrows, 120)
    for row_index in range(limit):
        names = [header_name(sheet.cell(row_index, col).value) for col in range(sheet.ncols)]
        positions = {}
        for wanted in REQUIRED_HEADERS + OPTIONAL_HEADERS:
            try:
                positions[wanted] = names.index(wanted)
            except ValueError:
                pass
        if all(name in positions for name in REQUIRED_HEADERS):
            return row_index, positions
    return None, None


def parse(path):
    book = xlrd.open_workbook(path, on_demand=True)
    output = []
    seen = set()
    parsed_sheets = []

    for sheet in book.sheets():
        header_row, positions = find_header(sheet)
        if positions is None:
            continue
        parsed_sheets.append(sheet.name)
        for row_index in range(header_row + 1, sheet.nrows):
            def get(name):
                col = positions.get(name)
                if col is None or col >= sheet.ncols:
                    return ""
                return cell_text(sheet.cell(row_index, col))

            card_number = get("CARD #")
            card_set = get("CARD SET")
            athlete = get("ATHLETE")
            team = get("TEAM")
            position = get("POSITION")
            sequence = get("SEQUENCE")

            if not any((card_number, card_set, athlete, team, position, sequence)):
                continue
            if not card_number or not card_set or not athlete:
                continue

            row = {
                "cardNumber": card_number,
                "cardSet": card_set,
                "athlete": athlete,
                "team": team,
                "position": position,
                "sequence": sequence,
                "sheet": sheet.name,
            }
            key = tuple(row[name] for name in ("cardNumber", "cardSet", "athlete", "team", "position", "sequence"))
            if key in seen:
                continue
            seen.add(key)
            output.append(row)

    book.release_resources()
    return {
        "schema": "tcos.panini.xlsRows.v1",
        "source": Path(path).name,
        "sheetCount": len(parsed_sheets),
        "sheets": parsed_sheets,
        "rowCount": len(output),
        "rows": output,
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: parse-panini-xls.py <checklist.xls>")
    result = parse(sys.argv[1])
    if not result["rows"]:
        raise SystemExit("no checklist rows found")
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
