"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { useWebSocket, type ChatMessage } from "@/hooks/useWebSocket";

interface Props {
  senderId: number;
  senderName: string;
  role: "DISPATCHER" | "DRIVER";
  /** For driver: their own driverId. For dispatcher: the driverId they're chatting with. */
  targetDriverId: number | null;
  routeId?: number | null;
}

export function ChatPanel({ senderId, senderName, role, targetDriverId, routeId }: Props) {
  const { messages, sendChatMessage, connected } = useWebSocket();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 1-1 filter: show only messages between this dispatcher and this driver
  const visible = messages.filter((m) => {
    if (targetDriverId == null) return true;
    if (role === "DRIVER") {
      // Driver sees messages targeting them OR sent by them
      return m.targetDriverId === senderId || m.senderId === senderId;
    }
    // Dispatcher sees messages targeting that driver OR sent by that driver
    return m.targetDriverId === targetDriverId || m.senderId === targetDriverId;
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !connected) return;
    sendChatMessage({
      senderId,
      senderName,
      role,
      targetDriverId,
      routeId: routeId ?? null,
      text: trimmed,
    });
    setText("");
  };

  return (
    <div className="flex flex-col rounded-[20px] border border-sand bg-white overflow-hidden" style={{ height: 340 }}>
      <div className="flex items-center gap-2 border-b border-sand px-4 py-3 bg-fog">
        <MessageCircle className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-semibold text-plum">
          {role === "DRIVER" ? "Чат с диспетчером" : "Чат с водителем"}
        </span>
        <span className={`ml-auto text-xs ${connected ? "text-emerald-600" : "text-gray-400"}`}>
          {connected ? "● онлайн" : "● офлайн"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {visible.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-6">Сообщений пока нет</p>
        )}
        {visible.map((m) => (
          <MessageBubble key={m.id} msg={m} isMine={m.senderId === senderId} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-sand px-3 py-2 flex gap-2">
        <input
          className="flex-1 rounded-xl border border-sand bg-fog px-3 py-2 text-sm outline-none focus:border-blue-400"
          placeholder={connected ? "Введите сообщение..." : "Нет соединения..."}
          value={text}
          disabled={!connected}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button
          onClick={send}
          disabled={!text.trim() || !connected}
          className="rounded-xl bg-blue-500 px-3 py-2 text-white disabled:opacity-40 hover:bg-blue-600 transition"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  return (
    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${isMine ? "bg-blue-500 text-white" : "bg-fog text-plum"}`}>
        {!isMine && (
          <p className="text-[10px] font-semibold opacity-60 mb-0.5">
            {msg.role === "DISPATCHER" ? "Диспетчер" : "Водитель"} · {msg.senderName}
          </p>
        )}
        {msg.text}
      </div>
      <span className="text-[10px] text-gray-400 mt-0.5">
        {new Date(msg.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}
