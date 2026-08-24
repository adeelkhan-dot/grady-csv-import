export const REQUIRED_HEADERS = ["email", "first_name", "last_name"] as const;

export const INVALID_ENCODING_ERROR = "File is not valid UTF-8";
export const MISSING_HEADER_ERROR = "CSV header is missing a required column";
export const DUPLICATE_HEADER_ERROR = "CSV header has a duplicated required column";
export const UNPARSEABLE_HEADER_ERROR = "CSV header could not be parsed";
export const UNPARSEABLE_ROW_REASON = "Row could not be parsed";
export const EMAIL_REQUIRED_REASON = "email is required";
export const FIRST_NAME_REQUIRED_REASON = "first_name is required";
export const LAST_NAME_REQUIRED_REASON = "last_name is required";
export const EMAIL_INVALID_REASON = "email is invalid";

export type CsvFileFailure = {
  ok: false;
  error: string;
};

export type ValidCsvRow = {
  kind: "valid";
  lineNumber: number;
  email: string;
  first_name: string;
  last_name: string;
};

export type InvalidCsvRow = {
  kind: "invalid";
  lineNumber: number;
  reason: string;
};

export type CsvRow = ValidCsvRow | InvalidCsvRow;

export type CsvParseSuccess = {
  ok: true;
  rows: CsvRow[];
};

export type CsvParseResult = CsvParseSuccess | CsvFileFailure;

export function parseImportCsv(bytes: Buffer): CsvParseResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: INVALID_ENCODING_ERROR };
  }

  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
  }

  const lines = splitFileLines(text);
  if (lines.length === 0) {
    return { ok: false, error: MISSING_HEADER_ERROR };
  }

  const headerFields = parseCsvLine(lines[0]);
  if (!headerFields) {
    return { ok: false, error: UNPARSEABLE_HEADER_ERROR };
  }

  const headerMap = mapRequiredHeaders(headerFields);
  if (!headerMap.ok) {
    return headerMap;
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    if (isBlankLine(line)) {
      continue;
    }

    const fields = parseCsvLine(line);
    if (!fields) {
      rows.push({
        kind: "invalid",
        lineNumber,
        reason: UNPARSEABLE_ROW_REASON,
      });
      continue;
    }

    rows.push(validateDataRow(fields, headerMap.indexes, lineNumber));
  }

  return { ok: true, rows };
}

function splitFileLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }

    if (line[i] === '"') {
      i += 1;
      let field = "";
      let closed = false;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          closed = true;
          i += 1;
          break;
        }
        field += line[i];
        i += 1;
      }
      if (!closed) {
        return null;
      }
      if (i < line.length && line[i] !== ",") {
        return null;
      }
      fields.push(field);
      if (i < line.length && line[i] === ",") {
        i += 1;
        continue;
      }
      break;
    }

    const comma = line.indexOf(",", i);
    if (comma === -1) {
      fields.push(line.slice(i));
      break;
    }
    fields.push(line.slice(i, comma));
    i = comma + 1;
  }

  return fields;
}

function mapRequiredHeaders(
  fields: string[],
): { ok: true; indexes: Record<(typeof REQUIRED_HEADERS)[number], number> } | CsvFileFailure {
  const indexes = {
    email: -1,
    first_name: -1,
    last_name: -1,
  };

  for (let i = 0; i < fields.length; i++) {
    const name = fields[i];
    if (name !== "email" && name !== "first_name" && name !== "last_name") {
      continue;
    }
    if (indexes[name] !== -1) {
      return { ok: false, error: DUPLICATE_HEADER_ERROR };
    }
    indexes[name] = i;
  }

  if (indexes.email === -1 || indexes.first_name === -1 || indexes.last_name === -1) {
    return { ok: false, error: MISSING_HEADER_ERROR };
  }

  return { ok: true, indexes };
}

function validateDataRow(
  fields: string[],
  indexes: Record<(typeof REQUIRED_HEADERS)[number], number>,
  lineNumber: number,
): CsvRow {
  const emailRaw = fields[indexes.email] ?? "";
  const firstRaw = fields[indexes.first_name] ?? "";
  const lastRaw = fields[indexes.last_name] ?? "";
  const emailTrimmed = emailRaw.trim();
  const first_name = firstRaw.trim();
  const last_name = lastRaw.trim();

  if (!emailTrimmed) {
    return { kind: "invalid", lineNumber, reason: EMAIL_REQUIRED_REASON };
  }
  if (!first_name) {
    return { kind: "invalid", lineNumber, reason: FIRST_NAME_REQUIRED_REASON };
  }
  if (!last_name) {
    return { kind: "invalid", lineNumber, reason: LAST_NAME_REQUIRED_REASON };
  }

  const email = emailTrimmed.toLowerCase();
  if (!isValidEmailShape(email)) {
    return { kind: "invalid", lineNumber, reason: EMAIL_INVALID_REASON };
  }

  return { kind: "valid", lineNumber, email, first_name, last_name };
}

export function isValidEmailShape(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0) {
    return false;
  }
  if (email.indexOf("@", at + 1) !== -1) {
    return false;
  }
  const domain = email.slice(at + 1);
  return domain.length > 0 && domain.includes(".");
}
