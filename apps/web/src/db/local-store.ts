const databaseName = "irodori-table-web-local";
const storeName = "sqlite-databases";
const version = 1;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    return await requestToPromise(request);
  } finally {
    db.close();
  }
}

export async function loadDatabaseBytes(databaseId: string): Promise<Uint8Array | null> {
  const value = await withStore<ArrayBuffer | Uint8Array | undefined>("readonly", (store) =>
    store.get(databaseId),
  );
  if (!value) {
    return null;
  }
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export async function saveDatabaseBytes(
  databaseId: string,
  bytes: Uint8Array,
): Promise<void> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await withStore<IDBValidKey>("readwrite", (store) => store.put(copy, databaseId));
}

export async function deleteDatabaseBytes(databaseId: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(databaseId));
}
