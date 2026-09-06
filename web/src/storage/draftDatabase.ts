let database: Promise<IDBDatabase> | undefined;

export function openDraftDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("yingya-drafts", 2);
    request.onupgradeneeded = () => {
      for (const name of ["files", "feedback"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { blocked = true; database = undefined; reject(new Error("请关闭旧版本页面后重试草稿保存")); };
  });
}
