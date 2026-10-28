import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../csv.ts";

test("reads quoted fields with commas and doubled quotes", () => {
  const rows = parseCsv('url,organisation\r\nhttps://site-a.example/,"Example agency, north"\r\nhttps://site-b.example/,"The ""example"" board"\r\n');
  assert.deepEqual(rows, [
    { url: "https://site-a.example/", organisation: "Example agency, north" },
    { url: "https://site-b.example/", organisation: 'The "example" board' },
  ]);
});

test("handles Unix line endings, a byte order mark, blank lines and missing trailing cells", () => {
  const rows = parseCsv("﻿URL,Kind,Active\nhttps://site-a.example/,app\n\n");
  assert.deepEqual(rows, [{ url: "https://site-a.example/", kind: "app", active: "" }]);
});

test("keeps line breaks inside quoted fields", () => {
  assert.equal(parseCsv('a,b\n"line one\nline two",x\n')[0].a, "line one\nline two");
});

test("toCsv quotes where needed and reads back the same", async () => {
  const { toCsv } = await import("../csv.ts");
  const rows = [{ a: "plain", b: "with, comma" }, { a: 'say "hi"', b: null }];
  const text = toCsv(["a", "b"], rows);
  assert.equal(text, 'a,b\r\nplain,"with, comma"\r\n"say ""hi""",\r\n');
  assert.deepEqual(parseCsv(text), [{ a: "plain", b: "with, comma" }, { a: 'say "hi"', b: "" }]);
});
