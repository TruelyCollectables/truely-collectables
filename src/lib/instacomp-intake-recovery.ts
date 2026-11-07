type DraftRecord = {
  owner: string;
  updatedAt: number;
  cards: unknown[];
};

const DATABASE = "kingmaker-insta-comp-intake";
const STORE = "seller-drafts";
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser photo recovery is unavailable."));
      return;
    }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "owner" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open saved intake."));
    request.onblocked = () => reject(new Error("Saved intake is busy in another browser tab."));
  });
}

export function createSerialIntakeQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const next = tail.then(work, work);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

export function recoverIntakeStatus(status: unknown) {
  // Preserve interrupted rows for explicit operator retry; never auto-rescan
  // on mount because the original request may already have completed remotely.
  return status === "working" ? "error" : status;
}

export async function readIntakeDrafts<T>(owner: string): Promise<T[]> {
  if (!owner) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not read saved intake."));
      transaction.onabort = () => reject(transaction.error || new Error("Saved intake read was interrupted."));
    });
    const request = transaction.objectStore(STORE).get(owner);
    const result = await new Promise<DraftRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as DraftRecord | undefined);
      request.onerror = () => reject(request.error || new Error("Could not load saved intake."));
    });
    await done;
    return Array.isArray(result?.cards) ? result.cards as T[] : [];
  } finally {
    database.close();
  }
}

export async function writeIntakeDrafts(owner: string, cards: unknown[]) {
  if (!owner) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save intake drafts."));
      transaction.onabort = () => reject(transaction.error || new Error("Intake draft save was interrupted."));
    });
    transaction.objectStore(STORE).put({
      owner,
      updatedAt: Date.now(),
      cards: Array.isArray(cards) ? cards : [],
    } satisfies DraftRecord);
    await done;
  } finally {
    database.close();
  }
}
