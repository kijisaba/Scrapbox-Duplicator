import {
  assert,
  exportPages,
  importPages,
  is,
  isErr,
  unwrapOk,
} from "./deps.ts";

const sid = Deno.env.get("SID");
const exportingProjectName = Deno.env.get("SOURCE_PROJECT_NAME"); //インポート元(本来はprivateプロジェクト)
const importingProjectName = Deno.env.get("DESTINATION_PROJECT_NAME"); //インポート先(publicプロジェクト)
const shouldDuplicateByDefault =
  Deno.env.get("SHOULD_DUPLICATE_BY_DEFAULT") === "True";

assert(sid, is.String);
assert(exportingProjectName, is.String);
assert(importingProjectName, is.String);

console.log(`Exporting a json file from "/${exportingProjectName}"...`);
const result = await exportPages(exportingProjectName, {
  sid,
  metadata: true,
});
// 最新の Result 型の仕様（ isErr ）に合わせた以下のチェックに書き換え
if (isErr(result)) {
  console.error("❌ Scrapbox からのデータ取得に失敗しました。");
  console.error("エラー詳細:", result.err);
  throw new Error("Export failed");
}
const { pages } = unwrapOk(result);
console.log(`Export ${pages.length}pages:`);
for (const page of pages) {
  console.log(`\t${page.title}`);
}

const importingPages = pages.filter(({ lines }) => {
  if (lines.some((line) => line.text.includes("[private.icon]"))) {
    return false;
  } else if (lines.some((line) => line.text.includes("[public.icon]"))) {
    return true;
  } else {
    return shouldDuplicateByDefault;
  }
});

if (importingPages.length === 0) {
  console.log("No page to be imported found.");
} else {
  console.log(
    `Importing ${importingPages.length} pages to "/${importingProjectName}"...`,
  );
  const result = await importPages(importingProjectName, {
    pages: importingPages,
  }, {
    sid,
  });
  // 最新の Result 型の仕様（ isErr ）に合わせた以下のチェックに書き換え
  if (isErr(result)) {
    console.error("❌ Scrapbox への流し込みに失敗しました。");
    console.error("エラー詳細:", result.err);
    throw new Error("Import failed");
  }
  console.log(unwrapOk(result));
}
