
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type DocumentRecord = {
  id: string;
  filename: string;
  status: string;
  chunk_count: number;
};

type Source = {
  source_id: string;
  document_id: string;
  page_number: number | null;
  similarity: number;
  excerpt: string;
};

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ChatResponse = {
  conversation_id: string;
  answer: string;
  sources: Source[];
};

async function apiRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : `Request failed with HTTP ${response.status}`
    );
  }

  return result as T;
}

export default function ChatPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshConversations = useCallback(async (token: string) => {
    const result = await apiRequest<{ conversations: Conversation[] }>(
      "/api/v1/conversations",
      token
    );

    setConversations(result.conversations);
  }, []);

  const openConversation = useCallback(
    async (conversationId: string) => {
      setError("");
      setLoading(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.replace("/");
          return;
        }

        const result = await apiRequest<{ messages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          citations: Source[] | null;
        }> }>(
          `/api/v1/conversations/${conversationId}/messages`,
          session.access_token
        );

        setActiveConversationId(conversationId);
        setMessages(
          result.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sources: Array.isArray(message.citations)
              ? message.citations
              : [],
          }))
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load conversation."
        );
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!active) return;

        if (sessionError || !session) {
          router.replace("/");
          return;
        }

        setEmail(session.user.email ?? "");

        const { data, error: documentsError } = await supabase
          .from("documents")
          .select("id, filename, status, chunk_count")
          .eq("user_id", session.user.id)
          .eq("status", "ready")
          .order("created_at", { ascending: false });

        if (!active) return;

        if (documentsError) {
          throw new Error(documentsError.message);
        }

        setDocuments(data ?? []);

        const result = await apiRequest<{ conversations: Conversation[] }>(
          "/api/v1/conversations",
          session.access_token
        );

        if (!active) return;

        setConversations(result.conversations);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Could not load your workspace."
          );
        }
      } finally {
        if (active) setChecking(false);
      }
    }

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && !session) router.replace("/");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  function startNewChat() {
    setActiveConversationId(null);
    setMessages([]);
    setQuestion("");
    setError("");
    setSelectedIds([]);
  }

  function toggleDocument(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = question.trim();

    if (!text || loading) return;

    setQuestion("");
    setError("");
    setMessages((current) => [
      ...current,
      { role: "user", content: text },
    ]);
    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/");
        return;
      }

      const result = await apiRequest<ChatResponse>(
        "/api/v1/chat",
        session.access_token,
        {
          method: "POST",
          body: JSON.stringify({
            question: text,
            document_ids: selectedIds.length ? selectedIds : null,
            conversation_id: activeConversationId,
          }),
        }
      );

      setActiveConversationId(result.conversation_id);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.answer,
          sources: result.sources ?? [],
        },
      ]);

      await refreshConversations(session.access_token);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to answer the question."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    const { error: logoutError } = await supabase.auth.signOut();

    if (logoutError) {
      setError(logoutError.message);
      return;
    }

    router.replace("/");
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        Loading DocuLens AI...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">DocuLens AI</h1>
            <p className="mt-1 break-all text-sm text-gray-400">{email}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-lg border border-gray-700 px-4 py-2 hover:bg-gray-800"
            >
              My documents
            </button>

            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-700 px-4 py-2 hover:bg-gray-800"
            >
              Log out
            </button>
          </div>
        </header>

        <div className="mt-8 grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <button
              onClick={startNewChat}
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              + New chat
            </button>

            <h2 className="mb-3 mt-6 text-sm font-semibold text-gray-400">
              CONVERSATION HISTORY
            </h2>

            <div className="space-y-2">
              {conversations.length === 0 && (
                <p className="text-sm text-gray-500">
                  Your saved conversations will appear here.
                </p>
              )}

              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => void openConversation(conversation.id)}
                  disabled={loading}
                  className={`w-full rounded-lg p-3 text-left text-sm hover:bg-gray-800 disabled:opacity-50 ${
                    activeConversationId === conversation.id
                      ? "bg-gray-800 ring-1 ring-blue-500"
                      : "bg-gray-950"
                  }`}
                >
                  <span className="block break-words font-medium">
                    {conversation.title}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {new Date(conversation.updated_at).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0 rounded-xl border border-gray-800 bg-gray-900 p-4 md:p-6">
            <div>
              <h2 className="text-xl font-semibold">Ask DocuLens</h2>
              <p className="mt-1 text-sm text-gray-400">
                Your questions and answers are saved automatically.
              </p>
            </div>

            <div className="mt-5 rounded-lg border border-gray-800 bg-gray-950 p-4">
              <h3 className="text-sm font-semibold">Search documents</h3>
              <p className="mt-1 text-xs text-gray-400">
                Select documents, or leave them unchecked to search all your
                ready documents.
              </p>

              {documents.length === 0 ? (
                <p className="mt-3 text-sm text-yellow-300">
                  Upload and process a document before asking questions.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {documents.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-gray-800 p-3 hover:border-blue-500"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(doc.id)}
                        onChange={() => toggleDocument(doc.id)}
                        className="mt-1 accent-blue-500"
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-sm">
                          {doc.filename}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {doc.chunk_count} chunks
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 min-h-64 space-y-5">
              {messages.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-700 p-6">
                  <p className="font-medium">Ask a question about your files.</p>
                  <p className="mt-2 text-sm text-gray-400">
                    Example: What should I learn in week 10 of the roadmap?
                  </p>
                </div>
              )}

              {messages.map((message, index) => (
                <article
                  key={message.id ?? `${index}-${message.role}`}
                  className={`rounded-lg p-4 ${
                    message.role === "user"
                      ? "ml-3 bg-blue-950 md:ml-12"
                      : "mr-3 bg-gray-800 md:mr-12"
                  }`}
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {message.role === "user" ? "You" : "DocuLens AI"}
                  </p>

                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {message.content}
                  </p>

                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-4 border-t border-gray-700 pt-3">
                      <p className="mb-2 text-sm font-semibold">Sources</p>

                      <div className="space-y-3">
                        {message.sources.map((source) => {
                          const document = documents.find(
                            (doc) => doc.id === source.document_id
                          );

                          return (
                            <div
                              key={`${index}-${source.source_id}`}
                              className="rounded-lg border border-gray-700 p-3"
                            >
                              <p className="break-words text-sm font-medium text-blue-300">
                                {source.source_id} ·{" "}
                                {document?.filename ?? "Document"}
                                {source.page_number != null
                                  ? ` · Page ${source.page_number}`
                                  : ""}
                              </p>

                              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-300">
                                {source.excerpt}
                              </p>

                              <p className="mt-2 text-xs text-gray-500">
                                Similarity: {source.similarity.toFixed(3)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              ))}

              {loading && (
                <p className="text-sm text-gray-400">
                  Loading conversation or generating an answer...
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 break-words rounded-lg bg-red-950 p-3 text-sm text-red-200"
              >
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question about your documents..."
                rows={3}
                maxLength={4000}
                disabled={loading}
                className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
              />

              <button
                type="submit"
                disabled={loading || !question.trim() || documents.length === 0}
                className="w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Thinking..." : "Ask question"}
              </button>
            </form>

            <p className="mt-3 text-xs text-gray-500">
              Powered by local Qwen and BGE-M3 models through Ollama.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
