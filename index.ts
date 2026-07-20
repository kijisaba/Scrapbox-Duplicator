import {
  assert,
  exportPages,
  getCSRFToken,
  importPages,
  is,
  isErr,
  unwrapOk,
} from "./deps.ts";

const sid = Deno.env.get("SID");
const exportingProjectName = Deno.env.get("SOURCE_PROJECT_NAME"); // インポート元（非公開プロジェクト等）
const importingProjectName = Deno.env.get("DESTINATION_PROJECT_NAME"); // インポート先（公開プロジェクト等）
const shouldDuplicateByDefault =
  Deno.env.get("SHOULD_DUPLICATE_BY_DEFAULT") === "True";

// 必須の環境変数が存在することを確認
assert(sid, is.String);
assert(exportingProjectName, is.String);
assert(importingProjectName, is.String);

// NOTE: Scrapbox はセキュリティ対策として、書き込み（インポートなど）リクエストの Origin や Referer を厳しく検証しています。
// Deno などのサーバーサイド環境からのリクエストにはこれらが自動付与されないため、
// 403 (CrossOriginWriteNotAllowedError) で弾かれる問題を、fetch をパッチすることで解決します。
const originalFetch = globalThis.fetch;
globalThis.fetch = function (
  input: string | Request | URL,
  init?: RequestInit,
): Promise<Response> {
  let url = "";
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else if (input instanceof Request) {
    url = input.url;
  }

  // scrapbox.io 宛てのリクエストに対してヘッダーを追加
  if (url.includes("scrapbox.io")) {
    const headers = new Headers(init?.headers || {});

    // Origin ヘッダーを強制付与
    if (!headers.has("Origin")) {
      headers.set("Origin", "https://scrapbox.io");
    }

    // Referer ヘッダーを強制付与
    if (!headers.has("Referer")) {
      // URLから対象のプロジェクト名を抽出。抽出できない場合は設定されたインポート先プロジェクト名を使用
      const match = url.match(/scrapbox\.io\/api\/page-data\/import\/([^\/]+)/) ||
                    url.match(/scrapbox\.io\/api\/pages\/([^\/]+)/);
      const projectName = match ? match[1] : importingProjectName;
      headers.set("Referer", `https://scrapbox.io/${projectName}`);
    }

    // 引数が Request オブジェクトの場合は、新しく Request を生成してヘッダーを上書き
    if (input instanceof Request) {
      const newInit: RequestInit = {
        method: input.method,
        headers: headers,
        body: input.body,
        redirect: input.redirect,
        signal: input.signal,
      };
      const newRequest = new Request(input.url, newInit);
      return originalFetch(newRequest);
    } else {
      // 引数が string や URL の場合は init を更新
      const newInit = { ...init, headers };
      return originalFetch(input, newInit);
    }
  }

  // scrapbox.io 以外へのリクエストはそのまま実行
  return originalFetch(input, init);
};

console.log(`Exporting a json file from "/${exportingProjectName}"...`);
const result = await exportPages(exportingProjectName, {
  sid,
  metadata: true,
});

if (isErr(result)) {
  console.error("❌ Scrapbox からのデータ取得に失敗しました。");
  console.error("エラー詳細:", result.err);
  throw new Error("Export failed");
}

const { pages } = unwrapOk(result);
console.log(`Exported ${pages.length} pages:`);
for (const page of pages) {
  console.log(`\t${page.title}`);
}

// 公開・非公開タグに基づき、インポートするページをフィルタリング
const importingPages = pages.filter(({ lines }) => {
  if (lines.some((line) => line.text.includes("[private.icon]"))) {
    return false; // 非公開アイコンがあれば除外
  } else if (lines.some((line) => line.text.includes("[public.icon]"))) {
    return true;  // 公開アイコンがあれば強制インポート
  } else {
    return shouldDuplicateByDefault; // デフォルト設定に従う
  }
});

if (importingPages.length === 0) {
  console.log("No page to be imported found.");
} else {
  // インポートに必要な CSRF トークンを取得する
  console.log("Fetching CSRF Token...");
  const csrfResult = await getCSRFToken({ sid, hostName: "scrapbox.io" });
  if (isErr(csrfResult)) {
    console.error("❌ CSRFトークンの取得に失敗しました。");
    console.error("エラー詳細:", csrfResult.err);
    throw new Error("Failed to get CSRF token");
  }
  const csrfToken = unwrapOk(csrfResult);

  console.log(
    `Importing ${importingPages.length} pages to "/${importingProjectName}"...`,
  );

  // パッチされた fetch により、自動的に Origin と Referer が付与された状態で実行されます
  const importResult = await importPages(importingProjectName, {
    pages: importingPages,
  }, {
    sid,
    csrfToken, // 取得したCSRFトークンを渡す
    hostName: "scrapbox.io",
  });

  if (isErr(importResult)) {
    console.error("❌ Scrapbox への流し込みに失敗しました。");
    console.error("エラー詳細:", importResult.err);
    throw new Error("Import failed");
  }

  console.log("✅ インポートが正常に完了しました！");
  console.log(unwrapOk(importResult));
}
