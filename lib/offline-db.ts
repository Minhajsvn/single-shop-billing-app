import type { Customer, DemoState, SyncOperation } from "@/lib/domain";

const DB_NAME = "shop-ledger-offline";
const DB_VERSION = 1;
const SNAPSHOT_KEY = "current";
const CUSTOMER_KEY = "customers";
const CRYPTO_KEY = "customer-cache-key";

type EncryptedPayload = { iv: number[]; ciphertext: ArrayBuffer };

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("snapshots")) database.createObjectStore("snapshots");
      if (!database.objectStoreNames.contains("private")) database.createObjectStore("private");
      if (!database.objectStoreNames.contains("keys")) database.createObjectStore("keys");
      if (!database.objectStoreNames.contains("outbox")) database.createObjectStore("outbox", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function encryptionKey(database: IDBDatabase) {
  const read = database.transaction("keys", "readonly").objectStore("keys").get(CRYPTO_KEY);
  const existing = await requestResult(read) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await requestResult(database.transaction("keys", "readwrite").objectStore("keys").put(key, CRYPTO_KEY));
  return key;
}

async function encryptCustomers(database: IDBDatabase, customers: Customer[]): Promise<EncryptedPayload> {
  const key = await encryptionKey(database);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(customers));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: Array.from(iv), ciphertext };
}

/** Every cached copy belongs to one signed-in user, so accounts sharing a browser never see each other's data. */
const scoped = (key: string, scope: string) => `${key}:${scope}`;

export async function persistOfflineSnapshot(state: DemoState, scope: string, savedAt = Date.now()) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const { customers, ...nonSensitiveState } = state;
    const encryptedCustomers = await encryptCustomers(database, customers);
    const transaction = database.transaction(["snapshots", "private", "outbox"], "readwrite");
    transaction.objectStore("snapshots").put({ ...nonSensitiveState, savedAt }, scoped(SNAPSHOT_KEY, scope));
    transaction.objectStore("private").put(encryptedCustomers, scoped(CUSTOMER_KEY, scope));
    for (const operation of state.syncOperations.filter((item) => item.status === "pending")) {
      transaction.objectStore("outbox").put(operation);
    }
  } finally {
    database.close();
  }
}

/** The state (customers excluded) last written by persistOfflineSnapshot for this user, with when it was saved. */
export async function loadOfflineSnapshot(scope: string): Promise<{ state: Omit<DemoState, "customers">; savedAt: number } | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const stored = await requestResult(database.transaction("snapshots", "readonly").objectStore("snapshots").get(scoped(SNAPSHOT_KEY, scope))) as (Omit<DemoState, "customers"> & { savedAt?: number }) | undefined;
    if (!stored || !Array.isArray(stored.products) || !Array.isArray(stored.syncOperations)) return null;
    const { savedAt, ...state } = stored;
    return { state, savedAt: typeof savedAt === "number" ? savedAt : 0 };
  } finally {
    database.close();
  }
}

/** Reads back the customer list written by persistOfflineSnapshot, decrypting it with this device's key. */
export async function loadOfflineCustomers(scope: string): Promise<Customer[] | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const encrypted = await requestResult(database.transaction("private", "readonly").objectStore("private").get(scoped(CUSTOMER_KEY, scope))) as EncryptedPayload | undefined;
    if (!encrypted) return null;
    const key = await encryptionKey(database);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(encrypted.iv) }, key, encrypted.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as Customer[];
  } catch {
    return null;
  } finally {
    database.close();
  }
}

/**
 * Removes a user's cached snapshot and encrypted customers (on sign-out), plus the unscoped copies written by
 * earlier builds, which could hold another account's or the old demo store's customers.
 */
export async function clearOfflineCache(scope: string | null) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["snapshots", "private"], "readwrite");
    transaction.objectStore("snapshots").delete(SNAPSHOT_KEY);
    transaction.objectStore("private").delete(CUSTOMER_KEY);
    if (scope) {
      transaction.objectStore("snapshots").delete(scoped(SNAPSHOT_KEY, scope));
      transaction.objectStore("private").delete(scoped(CUSTOMER_KEY, scope));
    }
  } finally {
    database.close();
  }
}

export async function clearSyncedOutbox(operations: SyncOperation[]) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction("outbox", "readwrite");
    for (const operation of operations.filter((item) => item.status === "synced")) {
      transaction.objectStore("outbox").delete(operation.id);
    }
  } finally {
    database.close();
  }
}
