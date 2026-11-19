"use client";

import { useEffect, useSyncExternalStore } from "react";

function subscribeToConnection(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getConnectionSnapshot() {
  return navigator.onLine;
}

function getServerConnectionSnapshot() {
  return true;
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const isOnline = useSyncExternalStore(
    subscribeToConnection,
    getConnectionSnapshot,
    getServerConnectionSnapshot,
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The app remains usable; only install/offline-shell support is unavailable.
    });
  }, []);

  return (
    <>
      {!isOnline ? (
        <div role="status" className="fixed inset-x-3 top-3 z-50 mx-auto max-w-md rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-950 shadow-lg">
          You are offline. Reconnect before submitting server-backed actions.
        </div>
      ) : null}
      {children}
    </>
  );
}
