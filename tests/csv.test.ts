import { expect, test } from "vitest";
import {
  DUPLICATE_HEADER_ERROR,
  EMAIL_INVALID_REASON,
  EMAIL_REQUIRED_REASON,
  FIRST_NAME_REQUIRED_REASON,
  INVALID_ENCODING_ERROR,
  LAST_NAME_REQUIRED_REASON,
  MISSING_HEADER_ERROR,
  parseImportCsv,
  UNPARSEABLE_ROW_REASON,
} from "@/lib/csv";

function parse(text: string) {
  return parseImportCsv(Buffer.from(text, "utf8"));
}

test("parses RFC 4180 quoted fields and strips a leading BOM", () => {
  const bom = "\uFEFF";
  const csv = `${bom}email,first_name,last_name\n"pat@example.com","Pat ""Pip""","Lee, Jr."\n`;
  const result = parse(csv);
  expect(result).toEqual({
    ok: true,
    rows: [
      {
        kind: "valid",
        lineNumber: 2,
        email: "pat@example.com",
        first_name: 'Pat "Pip"',
        last_name: "Lee, Jr.",
      },
    ],
  });
});

test("treats invalid UTF-8 as a file-level failure", () => {
  const result = parseImportCsv(Buffer.from([0xe2, 0x28, 0xa1]));
  expect(result).toEqual({ ok: false, error: INVALID_ENCODING_ERROR });
});

test("requires exact untrimmed header names in any order and ignores extras", () => {
  const result = parse(
    "dept,last_name,email,first_name\neng,Lee,pat@example.com,Pat\n",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.rows[0]).toMatchObject({
    kind: "valid",
    email: "pat@example.com",
    first_name: "Pat",
    last_name: "Lee",
  });
});

test("fails the file when a required header is missing, wrong, or duplicated", () => {
  expect(parse("email,first_name\npat@example.com,Pat\n")).toEqual({
    ok: false,
    error: MISSING_HEADER_ERROR,
  });
  expect(parse("Email,first_name,last_name\n")).toEqual({
    ok: false,
    error: MISSING_HEADER_ERROR,
  });
  expect(parse(" email,first_name,last_name\n")).toEqual({
    ok: false,
    error: MISSING_HEADER_ERROR,
  });
  expect(parse("email,email,first_name,last_name\n")).toEqual({
    ok: false,
    error: DUPLICATE_HEADER_ERROR,
  });
});

test("skips fully blank lines and does not emit rows for them", () => {
  const result = parse(
    "email,first_name,last_name\n\n  \npat@example.com,Pat,Lee\n",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.rows).toEqual([
    {
      kind: "valid",
      lineNumber: 4,
      email: "pat@example.com",
      first_name: "Pat",
      last_name: "Lee",
    },
  ]);
});

test("treats unparseable lines as row failures", () => {
  const result = parse(
    'email,first_name,last_name\n"pat@example.com,Pat,Lee\nkim@example.com,Kim,Ng\n',
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.rows).toEqual([
    {
      kind: "invalid",
      lineNumber: 2,
      reason: UNPARSEABLE_ROW_REASON,
    },
    {
      kind: "valid",
      lineNumber: 3,
      email: "kim@example.com",
      first_name: "Kim",
      last_name: "Ng",
    },
  ]);
});

test("trims fields, lowercases email, and keeps name casing", () => {
  const result = parse(
    "email,first_name,last_name\n  PAT@Example.COM  ,  Pat  ,  Lee  \n",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.rows[0]).toEqual({
    kind: "valid",
    lineNumber: 2,
    email: "pat@example.com",
    first_name: "Pat",
    last_name: "Lee",
  });
});

test("validates required fields and email shape", () => {
  const result = parse(
    [
      "email,first_name,last_name",
      ",Pat,Lee",
      "pat@example.com,,Lee",
      "pat@example.com,Pat,",
      "pat@localhost,Pat,Lee",
      "@x.com,Pat,Lee",
      "pat@example.com,Pat,Lee",
      ",,\n",
    ].join("\n"),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.rows.map((row) => [row.kind, row.kind === "invalid" ? row.reason : row.email])).toEqual(
    [
      ["invalid", EMAIL_REQUIRED_REASON],
      ["invalid", FIRST_NAME_REQUIRED_REASON],
      ["invalid", LAST_NAME_REQUIRED_REASON],
      ["invalid", EMAIL_INVALID_REASON],
      ["invalid", EMAIL_INVALID_REASON],
      ["valid", "pat@example.com"],
      ["invalid", EMAIL_REQUIRED_REASON],
    ],
  );
});

test("empty fields parsed from commas are data rows, not skipped blanks", () => {
  const result = parse("email,first_name,last_name\n,,\n");
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.rows).toEqual([
    { kind: "invalid", lineNumber: 2, reason: EMAIL_REQUIRED_REASON },
  ]);
});
