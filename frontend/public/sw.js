// Service Worker for offline GPS buffering
const CACHE_NAME = "velto-sw-v1";
const GPS_QUEUE_KEY = "gps_offline_queue";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages from the main thread
self.addEventListener("message", (event) => {
  if (event.data?.type === "GPS_POINT") {
    bufferGpsPoint(event.data.payload);
  }
  if (event.data?.type === "SYNC_GPS") {
    syncGpsQueue(event.data.apiUrl, event.data.vehicleId);
  }
});

async function bufferGpsPoint(point) {
  const queue = await getQueue();
  queue.push({ ...point, bufferedAt: Date.now() });
  await saveQueue(queue);

  // Notify clients about buffer size
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: "GPS_BUFFER_SIZE", size: queue.length });
  });
}

async function syncGpsQueue(apiUrl, vehicleId) {
  const queue = await getQueue();
  if (!queue.length) return;

  try {
    const response = await fetch(`${apiUrl}/gps/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        vehicleId,
        locations: queue.map((p) => ({
          lat: p.lat,
          lon: p.lon,
          speed: p.speed,
          timestamp: new Date(p.timestamp || p.bufferedAt).toISOString(),
        })),
      }),
    });

    if (response.ok) {
      await clearQueue();
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({ type: "GPS_SYNC_SUCCESS", count: queue.length });
      });
    }
  } catch (err) {
    // Stay offline, keep queue
  }
}

// IndexedDB helpers
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("velto-gps", 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("queue", { autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}

async function getQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readonly");
    const req = tx.objectStore("queue").getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror = reject;
  });
}

async function saveQueue(queue) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    store.clear();
    queue.forEach((item) => store.add(item));
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

async function clearQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").clear();
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}
