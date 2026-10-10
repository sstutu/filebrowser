import { copy } from "@/utils/clipboard";

export async function copyPreparedPublicLinks(prepare: () => Promise<string>) {
  const text = prepare();
  if (
    window.isSecureContext &&
    typeof ClipboardItem !== "undefined" &&
    navigator.clipboard?.write
  ) {
    const blob = text.then(
      (value) => new Blob([value], { type: "text/plain" })
    );
    void blob.catch(() => {});
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": blob }),
      ]);
      return;
    } catch {
      await copy({ text: await text });
    }
  } else {
    await copy({ text: await text });
  }
}

export function publicLinksTSV(rows: { name: string; link: string }[]) {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return /[\t\r\n"]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [
    ["文件名", "公网访问链接"],
    ...rows.map((row) => [row.name, row.link]),
  ]
    .map((row) => row.map(cell).join("\t"))
    .join("\r\n");
}
