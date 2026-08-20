import type { SessionMediaRef } from "./types";

const DB_NAME = "couple-lab-device-store";
const DB_VERSION = 1;
const MEDIA_STORE = "session-media";
const DIAGNOSTIC_STORE = "diagnostics";

export interface DiagnosticEventRecord {
  id: string;
  sessionId?: string;
  name: string;
  status: "info" | "success" | "error";
  timestamp: string;
  durationMs?: number;
  errorCode?: string;
  attempt?: number;
  phase?: string;
  itemCount?: number;
  language?: string;
  wordCount?: number;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb-unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MEDIA_STORE)) database.createObjectStore(MEDIA_STORE);
      if (!database.objectStoreNames.contains(DIAGNOSTIC_STORE)) {
        database.createObjectStore(DIAGNOSTIC_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-open-failed"));
  });
}

function completeTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb-transaction-failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb-transaction-aborted"));
  });
}

export async function saveSessionMedia(sessionId: string, blob: Blob): Promise<SessionMediaRef> {
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, "readwrite");
  transaction.objectStore(MEDIA_STORE).put(blob, sessionId);
  await completeTransaction(transaction);
  database.close();
  return {
    storage: "indexeddb",
    key: sessionId,
    mimeType: blob.type || "video/webm",
    sizeBytes: blob.size,
    savedAt: new Date().toISOString()
  };
}

export async function loadSessionMedia(key: string) {
  const database = await openDatabase();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE, "readonly");
    const request = transaction.objectStore(MEDIA_STORE).get(key);
    request.onsuccess = () => {
      database.close();
      resolve(request.result as Blob | undefined);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("media-load-failed"));
    };
  });
}

export async function deleteSessionMedia(key: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, "readwrite");
  transaction.objectStore(MEDIA_STORE).delete(key);
  await completeTransaction(transaction);
  database.close();
}

export async function clearDeviceStore() {
  const database = await openDatabase();
  const transaction = database.transaction([MEDIA_STORE, DIAGNOSTIC_STORE], "readwrite");
  transaction.objectStore(MEDIA_STORE).clear();
  transaction.objectStore(DIAGNOSTIC_STORE).clear();
  await completeTransaction(transaction);
  database.close();
}

export async function logDiagnostic(
  event: Omit<DiagnosticEventRecord, "id" | "timestamp"> & { id?: string; timestamp?: string }
) {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DIAGNOSTIC_STORE, "readwrite");
    const store = transaction.objectStore(DIAGNOSTIC_STORE);
    const record: DiagnosticEventRecord = {
      ...event,
      id: event.id ?? `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: event.timestamp ?? new Date().toISOString()
    };
    store.put(record);
    const allRequest = store.getAllKeys();
    allRequest.onsuccess = () => {
      const overflow = allRequest.result.slice(0, Math.max(0, allRequest.result.length - 500));
      overflow.forEach((key) => store.delete(key));
    };
    await completeTransaction(transaction);
    database.close();
  } catch {
    // Diagnostics must never break the couple's primary flow.
  }
}

export async function getDiagnostics() {
  const database = await openDatabase();
  return new Promise<DiagnosticEventRecord[]>((resolve, reject) => {
    const transaction = database.transaction(DIAGNOSTIC_STORE, "readonly");
    const request = transaction.objectStore(DIAGNOSTIC_STORE).getAll();
    request.onsuccess = () => {
      database.close();
      resolve((request.result as DiagnosticEventRecord[]).sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("diagnostics-load-failed"));
    };
  });
}

export async function clearDiagnostics() {
  const database = await openDatabase();
  const transaction = database.transaction(DIAGNOSTIC_STORE, "readwrite");
  transaction.objectStore(DIAGNOSTIC_STORE).clear();
  await completeTransaction(transaction);
  database.close();
}
