import { userStorageKey } from "../session";
const databases = new Map<string, Promise<IDBDatabase>>();

export function openDraftDatabase(name = userStorageKey("yingya-drafts")): Promise<IDBDatabase> {
  const existing = databases.get(name);
  if (existing) return existing;
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      for (const name of ["files", "feedback"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); databases.delete(name); };
      resolve(db);
    };
    request.onerror = () => { databases.delete(name); reject(request.error); };
    request.onblocked = () => { blocked = true; databases.delete(name); reject(new Error("请关闭旧版本页面后重试草稿保存")); };
  });
  databases.set(name, database);
  return database;
}
