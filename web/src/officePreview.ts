import { unzip } from "fflate";
import type { DocumentContent, DocumentKind, DocumentSection } from "./assetDocuments";

const xml = (bytes: Uint8Array | undefined) => {
  if (!bytes) throw new Error("文档内容不完整，请下载后查看");
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("文档内容无法读取，请下载后查看");
  return document;
};
const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS("*", name));
const textOf = (node: Document | Element) => elements(node, "t").map(element => element.textContent ?? "").join("");

export async function readOfficeDocument(bytes: Uint8Array, kind: DocumentKind, signal: AbortSignal, thumbnail: boolean): Promise<DocumentContent> {
  const matcher = kind === "docx" ? /^word\/document\.xml$/ : kind === "xlsx" ? /^xl\/(workbook\.xml|_rels\/workbook\.xml.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/ : /^ppt\/(presentation\.xml|_rels\/presentation\.xml.rels|slides\/[^/]+\.xml)$/;
  let total = 0, oversized = false;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    signal.throwIfAborted();
    let settled = false;
    let terminate = () => {};
    const abort = () => { terminate(); reject(new DOMException("已取消", "AbortError")); };
    terminate = unzip(bytes, { filter: file => {
      if (!matcher.test(file.name)) return false;
      total += file.originalSize;
      if (file.originalSize > 8 * 1024 * 1024 || total > 24 * 1024 * 1024) { oversized = true; return false; }
      return true;
    } }, (error, result) => {
      settled = true;
      signal.removeEventListener("abort", abort);
      if (oversized) reject(new Error("文档内容较多，请下载后查看"));
      else if (error) reject(new Error("文档无法读取，可能已加密或损坏，请下载后查看"));
      else resolve(result);
    });
    if (!settled) signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted();
  const sections: DocumentSection[] = [];
  let truncated = false;
  const textLimit = thumbnail ? 4000 : 100000;
  if (kind === "docx") {
    const text = elements(xml(files["word/document.xml"]), "p").map(textOf).join("\n\n");
    return { text: text.slice(0, textLimit), truncated: text.length > textLimit };
  }
  const folder = kind === "xlsx" ? "xl" : "ppt";
  const main = kind === "xlsx" ? "workbook.xml" : "presentation.xml";
  const relationships = new Map(elements(xml(files[`${folder}/_rels/${main}.rels`]), "Relationship")
    .filter(element => element.getAttribute("TargetMode") !== "External")
    .map(element => [element.getAttribute("Id"), new URL(element.getAttribute("Target") ?? "", `https://office.invalid/${folder}/${main}`).pathname.slice(1)]));
  const items = elements(xml(files[`${folder}/${main}`]), kind === "xlsx" ? "sheet" : "sldId");
  const shared = files["xl/sharedStrings.xml"] ? elements(xml(files["xl/sharedStrings.xml"]), "si").map(textOf) : [];
  const itemLimit = thumbnail ? 1 : 50;
  for (const [index, item] of items.slice(0, itemLimit).entries()) {
    const id = Array.from(item.attributes).find(attribute => attribute.localName === "id" && attribute.namespaceURI)?.value;
    const path = relationships.get(id ?? null);
    const document = xml(path ? files[path] : undefined);
    if (kind === "pptx") {
      const text = elements(document, "p").map(textOf).join("\n");
      sections.push({ title: `第 ${index + 1} 页`, text: text.slice(0, textLimit) });
      truncated ||= text.length > textLimit;
    } else {
      const allRows = elements(document, "row");
      const rows = allRows.slice(0, thumbnail ? 12 : 200).map(row => {
        const values: string[] = [];
        for (const cell of elements(row, "c")) {
          const column = (cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0] ?? "").split("").reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
          if (column >= 30) { truncated = true; continue; }
          const type = cell.getAttribute("t");
          const value = elements(cell, "v")[0]?.textContent ?? "";
          values[Math.max(0, column)] = (type === "s" ? shared[Number(value)] ?? "" : type === "inlineStr" ? textOf(cell) : type === "b" ? value === "1" ? "是" : "否" : value).slice(0, 2000);
        }
        return Array.from({ length: values.length }, (_, i) => values[i] ?? "");
      });
      truncated ||= rows.length < allRows.length;
      sections.push({ title: item.getAttribute("name") ?? `工作表 ${index + 1}`, rows });
    }
  }
  truncated ||= items.length > sections.length;
  return { text: "", sections, truncated };
}
