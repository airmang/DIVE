import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantMessageData,
  ChatMessage,
  ToolCallMessageData,
  ToolResultMessageData,
  UserMessageData,
} from "../components/chat/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const CANNED_RESPONSES: string[] = [
  "좋습니다. 먼저 목표를 작은 로드맵 단계로 나눠 제안드릴게요.",
  "요구를 파악했어요. 폴더 구조부터 살펴본 뒤 구현 방향을 정리하겠습니다.",
  "알겠습니다. 관련 파일을 읽어서 현재 구조를 확인한 다음 작업을 이어가겠습니다.",
  "네, 해당 기능을 만들기 위해 필요한 단계를 정리하고 첫 단계부터 진행해 볼게요.",
];

function pickResponse(): string {
  return CANNED_RESPONSES[Math.floor(Math.random() * CANNED_RESPONSES.length)];
}

function tokenize(text: string): string[] {
  const parts: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (ch === " " || ch === "\n" || buf.length >= 3) {
      parts.push(buf);
      buf = "";
    }
  }
  if (buf.length) parts.push(buf);
  return parts;
}

interface UseMockChatStream {
  messages: ChatMessage[];
  sendUserMessage: (text: string) => void;
  isStreaming: boolean;
  reset: (seed?: ChatMessage[]) => void;
}

export interface MockStreamOptions {
  initialMessages?: ChatMessage[];
  tokenIntervalMs?: number;
  firstTokenDelayMs?: number;
  toolCallProbability?: number;
}

export function useMockChatStream({
  initialMessages = [],
  tokenIntervalMs = 50,
  firstTokenDelayMs = 500,
  toolCallProbability = 0.4,
}: MockStreamOptions = {}): UseMockChatStream {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  const clearAllTimers = useCallback(() => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  }, []);

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  const updateAssistant = useCallback((id: string, patch: Partial<AssistantMessageData>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.kind === "assistant" ? { ...m, ...patch } : m)),
    );
  }, []);

  const streamAssistant = useCallback(
    (assistantId: string, fullText: string, onDone: () => void) => {
      const tokens = tokenize(fullText);
      let idx = 0;
      let acc = "";
      const tick = () => {
        if (idx >= tokens.length) {
          updateAssistant(assistantId, { streaming: false, content: fullText });
          onDone();
          return;
        }
        acc += tokens[idx++];
        updateAssistant(assistantId, { content: acc });
        schedule(tick, tokenIntervalMs);
      };
      schedule(tick, tokenIntervalMs);
    },
    [schedule, tokenIntervalMs, updateAssistant],
  );

  const appendToolFlow = useCallback(
    (onDone: () => void) => {
      const callMsg: ToolCallMessageData = {
        id: uid("tc"),
        kind: "tool_call",
        createdAt: Date.now(),
        toolName: "list_dir",
        paramsPreview: 'path: "./src"',
        status: "pending",
      };
      setMessages((prev) => [...prev, callMsg]);
      schedule(() => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === callMsg.id && m.kind === "tool_call" ? { ...m, status: "approved" } : m,
          ),
        );
        schedule(() => {
          const resultMsg: ToolResultMessageData = {
            id: uid("tr"),
            kind: "tool_result",
            createdAt: Date.now(),
            toolName: "list_dir",
            success: true,
            summary: "6개 파일: App.tsx, main.tsx, styles/, components/, hooks/, pages/",
          };
          setMessages((prev) => [...prev, resultMsg]);
          onDone();
        }, 600);
      }, 400);
    },
    [schedule],
  );

  const sendUserMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isStreaming) return;

      const userMsg: UserMessageData = {
        id: uid("u"),
        kind: "user",
        createdAt: Date.now(),
        content: trimmed,
      };
      const assistantMsg: AssistantMessageData = {
        id: uid("a"),
        kind: "assistant",
        createdAt: Date.now() + 1,
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      schedule(() => {
        streamAssistant(assistantMsg.id, pickResponse(), () => {
          if (Math.random() < toolCallProbability) {
            appendToolFlow(() => setIsStreaming(false));
          } else {
            setIsStreaming(false);
          }
        });
      }, firstTokenDelayMs);
    },
    [
      appendToolFlow,
      firstTokenDelayMs,
      isStreaming,
      schedule,
      streamAssistant,
      toolCallProbability,
    ],
  );

  const reset = useCallback(
    (seed?: ChatMessage[]) => {
      clearAllTimers();
      setIsStreaming(false);
      setMessages(seed ?? []);
    },
    [clearAllTimers],
  );

  return { messages, sendUserMessage, isStreaming, reset };
}
