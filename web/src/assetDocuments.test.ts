import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetDocumentKind, csvRows, readDocument } from './assetDocuments';
import type { AssetLibraryItem } from './types';
const asset = { sourceName: 'brief.md', mimeType: 'application/octet-stream', url: '/assets/brief' } as AssetLibraryItem;
afterEach(() => vi.unstubAllGlobals());
describe('asset document previews', () => {
  it('recognizes common formats even when uploads have generic MIME types', () => {
    for (const [name, kind] of [['brief.MD', 'markdown'], ['budget.csv', 'csv'], ['plan.docx', 'docx'], ['budget.xlsx', 'xlsx'], ['slides.pptx', 'pptx'], ['data.json', 'json'], ['notes.txt', 'text'], ['source.py', 'text']]) {
      expect(assetDocumentKind({ ...asset, sourceName: name })).toBe(kind);
    }
    expect(assetDocumentKind({ ...asset, sourceName: 'model.3mf' })).toBeNull();
    expect(assetDocumentKind({ ...asset, sourceName: undefined, mimeType: 'text/plain; charset=UTF-8' })).toBe('text');
  });
  it('preserves quoted CSV commas, line breaks, quotes and empty cells', () => {
    expect(csvRows('name,notes,\r\n"Lake","one, two\nthree ""quoted""",')).toEqual([
      ['name', 'notes', ''], ['Lake', 'one, two\nthree "quoted"', ''],
    ]);
    expect(csvRows('a\nb\nc', 2)).toEqual([['a'], ['b']]);
  });
  it('limits table size even for pathological CSV input', () => {
    const rows = csvRows(Array.from({length: 250}, () => Array(40).fill('x'.repeat(2100)).join(',')).join('\n'));
    expect(rows).toHaveLength(200); expect(rows[0]).toHaveLength(30); expect(rows[0][0]).toHaveLength(2000);
  });
  it('only reads a bounded text excerpt for thumbnails and cancels the rest', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(40000))); }, cancel,
    }))));
    const result = await readDocument(asset, 'markdown', new AbortController().signal, true);
    expect(result.text).toHaveLength(32768); expect(result.truncated).toBe(true); expect(cancel).toHaveBeenCalled();
  });
  it('rejects oversized full previews with or without a content length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('file', {headers: {'content-length':'3000000'}})));
    await expect(readDocument(asset, 'text', new AbortController().signal)).rejects.toThrow('文件较大');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(2100000))));
    await expect(readDocument(asset, 'text', new AbortController().signal)).rejects.toThrow('文件较大');
  });
  it('reports unavailable files rather than parsing the error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', {status:404})));
    await expect(readDocument(asset, 'markdown', new AbortController().signal)).rejects.toThrow('文件读取失败');
  });
});
