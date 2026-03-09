import { useState, useRef, useEffect } from "react";
import { useEditorStore } from "../store/editor-store.js";
import type { ExecutionEvent } from "@sweny-ai/engine";

export function LiveConnectPanel() {
  const { liveConnection, setLiveConnection, applyEvent, resetExecution, setMode } = useEditorStore();
  const [url, setUrl] = useState("ws://localhost:4000/events");
  const [transport, setTransport] = useState<"websocket" | "sse">("websocket");
  const wsRef = useRef<WebSocket | null>(null);
  const evsRef = useRef<EventSource | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      evsRef.current?.close();
    };
  }, []);

  function connect() {
    resetExecution();
    setLiveConnection({ url, transport, status: "connecting" });

    if (transport === "websocket") {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setLiveConnection({ url, transport, status: "connected" });

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as ExecutionEvent;
          applyEvent(event);
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => setLiveConnection({ url, transport, status: "error", error: "WebSocket error" });

      ws.onclose = () => setLiveConnection(liveConnection ? { ...liveConnection, status: "disconnected" } : null);
    } else {
      // SSE
      const es = new EventSource(url);
      evsRef.current = es;

      es.onopen = () => setLiveConnection({ url, transport, status: "connected" });

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as ExecutionEvent;
          applyEvent(event);
        } catch {
          /* ignore malformed */
        }
      };

      es.onerror = () => setLiveConnection({ url, transport, status: "error", error: "SSE error" });
    }
  }

  function disconnect() {
    wsRef.current?.close();
    evsRef.current?.close();
    setLiveConnection(null);
    setMode("design");
    resetExecution();
  }

  const isConnected = liveConnection?.status === "connected";
  const isConnecting = liveConnection?.status === "connecting";

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Live Execution</span>
        {liveConnection && (
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              isConnected
                ? "bg-green-100 text-green-700"
                : isConnecting
                  ? "bg-yellow-100 text-yellow-700"
                  : liveConnection.status === "error"
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
            }`}
          >
            {liveConnection.status}
          </span>
        )}
        <div className="flex-1" />
        {!isConnected && !isConnecting && (
          <>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as "websocket" | "sse")}
              className="px-2 py-1 text-xs border border-gray-300 rounded"
            >
              <option value="websocket">WebSocket</option>
              <option value="sse">SSE</option>
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://host/events"
              className="px-2 py-1 text-xs border border-gray-300 rounded w-56"
            />
            <button onClick={connect} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500">
              Connect
            </button>
          </>
        )}
        {(isConnected || isConnecting) && (
          <button onClick={disconnect} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500">
            Disconnect
          </button>
        )}
      </div>
      {liveConnection?.error && <p className="text-xs text-red-600 mt-1">{liveConnection.error}</p>}
    </div>
  );
}
