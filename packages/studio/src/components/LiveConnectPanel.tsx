import { useState, useRef, useEffect } from "react";
import { useEditorStore } from "../store/editor-store.js";
import type { ExecutionEvent, NodeResult } from "@sweny-ai/core";

export function LiveConnectPanel() {
  const { liveConnection, setLiveConnection, applyEvent, resetExecution, setMode, completedNodes, currentNodeId } =
    useEditorStore();
  const [url, setUrl] = useState("ws://localhost:4000/events");
  const [transport, setTransport] = useState<"websocket" | "sse">("websocket");
  const wsRef = useRef<WebSocket | null>(null);
  const evsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      evsRef.current?.close();
    };
  }, []);

  function connect() {
    resetExecution();
    const connUrl = url;
    const connTransport = transport;
    setLiveConnection({ url: connUrl, transport: connTransport, status: "connecting" });

    if (connTransport === "websocket") {
      const ws = new WebSocket(connUrl);
      wsRef.current = ws;

      ws.onopen = () => setLiveConnection({ url: connUrl, transport: connTransport, status: "connected" });

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as ExecutionEvent;
          applyEvent(event);
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onerror = () =>
        setLiveConnection({ url: connUrl, transport: connTransport, status: "error", error: "WebSocket error" });

      ws.onclose = () => {
        wsRef.current = null;
        setLiveConnection({ url: connUrl, transport: connTransport, status: "disconnected" });
      };
    } else {
      const es = new EventSource(connUrl);
      evsRef.current = es;

      es.onopen = () => setLiveConnection({ url: connUrl, transport: connTransport, status: "connected" });

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as ExecutionEvent;
          applyEvent(event);
        } catch {
          /* ignore malformed messages */
        }
      };

      es.onerror = () => {
        evsRef.current = null;
        setLiveConnection({ url: connUrl, transport: connTransport, status: "error", error: "SSE error" });
      };
    }
  }

  function disconnect() {
    wsRef.current?.close();
    wsRef.current = null;
    evsRef.current?.close();
    evsRef.current = null;
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

      {/* Execution trace */}
      {(currentNodeId || Object.keys(completedNodes).length > 0) && (
        <div className="mt-2 max-h-36 overflow-y-auto flex flex-col gap-0.5">
          {Object.entries(completedNodes as Record<string, NodeResult>).map(([id, result]) => {
            const icon = result.status === "success" ? "ok" : result.status === "failed" ? "fail" : "skip";
            const iconColor =
              result.status === "success"
                ? "text-green-600"
                : result.status === "failed"
                  ? "text-red-600"
                  : "text-gray-400";
            return (
              <div key={id} className="flex items-baseline gap-1.5 text-xs leading-tight">
                <span className={`font-bold flex-shrink-0 ${iconColor}`}>{icon}</span>
                <span className="font-mono text-gray-700 flex-shrink-0">{id}</span>
                {result.toolCalls.length > 0 && (
                  <span className="px-1 rounded bg-blue-50 text-blue-600 text-[10px] flex-shrink-0">
                    {result.toolCalls.length} tools
                  </span>
                )}
              </div>
            );
          })}
          {currentNodeId && (
            <div className="flex items-baseline gap-1.5 text-xs leading-tight text-blue-500 animate-pulse">
              <span className="font-bold flex-shrink-0">*</span>
              <span className="font-mono flex-shrink-0">{currentNodeId}</span>
              <span className="text-[10px] text-blue-400">running...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
