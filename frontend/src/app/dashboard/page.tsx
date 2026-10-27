
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

type DocumentRecord = {
  id: string;
  filename: string;
  status: string;
  created_at: string;
  chunk_count: number | null;
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

async function apiRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
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

export default function HomeWorkspace() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [checking, setChecking] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const loadDocuments = useCallback(async (userId: string) => {
    const { data, error: queryError } = await supabase
      .from("documents")
      .select("id, filename, status, created_at, chunk_count")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (queryError) {
      throw new Error(`Could not load documents: ${queryError.message}`);
    }

    setDocuments(data ?? []);
  }, []);

  const refreshConversations = useCallback(async (token: string) => {
    const result = await apiRequest<{ conversations: Conversation[] }>(
      "/api/v1/conversations",
      token
    );

    setConversations(result.conversations);
  }, []);

  const getSession = useCallback(async () => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    if (!session) {
      router.replace("/");
      return null;
    }

    return session;
  }, [router]);

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

        const { data, error: queryError } = await supabase
          .from("documents")
          .select("id, filename, status, created_at, chunk_count")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false });

        if (!active) return;

        if (queryError) throw queryError;

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
            err instanceof Error
              ? err.message
              : "Could not load your workspace."
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
      if (!active) return;

      if (!session) {
        router.replace("/");
      } else {
        setEmail(session.user.email ?? "");
      }
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
    setStatus("");
  }
  
async function handleDeleteConversation(conversation: Conversation) {
  const confirmed = window.confirm(
    `Delete "${conversation.title}" and all its messages permanently?`
  );

  if (!confirmed) return;

  setError("");
  setDeletingConversationId(conversation.id);

  try {
    const session = await getSession();

    if (!session) return;

    await apiRequest<{ deleted: boolean }>(
      `/api/v1/conversations/${conversation.id}`,
      session.access_token,
      { method: "DELETE" }
    );

    setConversations((current) =>
      current.filter((item) => item.id !== conversation.id)
    );

    if (activeConversationId === conversation.id) {
      setActiveConversationId(null);
      setMessages([]);
      setQuestion("");
    }

    setStatus("Conversation deleted successfully.");
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Could not delete the conversation."
    );
  } finally {
    setDeletingConversationId(null);
  }
}


  function toggleDocument(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  async function handleUpload(
    event: FormEvent<HTMLInputElement>
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    input.value = "";

    if (!file) return;

    setStatus("");
    setError("");

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = MIME_TYPES[extension];

    if (!mimeType) {
      setError("Choose a PDF, DOCX, PPTX, or TXT file.");
      return;
    }

    if (file.size === 0) {
      setError("The selected file is empty.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("The maximum file size is 25 MB.");
      return;
    }

    setUploading(true);

    let documentCreated = false;
    let storagePath = "";

    try {
      const session = await getSession();

      if (!session) return;

      const userId = session.user.id;

      storagePath =
        `${userId}/${crypto.randomUUID()}/` +
        file.name.replace(/[^\w.\- ()]/g, "_");

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: document, error: databaseError } = await supabase
        .from("documents")
        .insert({
          user_id: userId,
          filename: file.name,
          storage_path: storagePath,
          mime_type: mimeType,
          status: "processing",
        })
        .select("id, filename, status, created_at, chunk_count")
        .single();

      if (databaseError) {
        await supabase.storage.from("documents").remove([storagePath]);
        throw databaseError;
      }

      documentCreated = true;

      setStatus(`Uploaded ${file.name}. Processing with local AI...`);

      const result = await apiRequest<{
        document_id: string;
        filename: string;
        status: string;
        chunk_count: number;
      }>(
        `/api/v1/documents/${document.id}/process`,
        session.access_token,
        { method: "POST" }
      );

      await loadDocuments(userId);

      setStatus(
        `Success! ${result.filename} is ready with ${result.chunk_count} searchable chunks.`
      );

      // Automatically include the newly processed document in chat.
      setSelectedIds((current) =>
        current.includes(document.id) ? current : [...current, document.id]
      );
    } catch (err) {
      console.error("Upload/processing error:", err);

      const message =
        err instanceof Error ? err.message : "Upload failed.";

      if (documentCreated) {
        setStatus("The file was uploaded, but processing failed.");
        setError(message);

        const session = await getSession().catch(() => null);

        if (session) {
          await loadDocuments(session.user.id).catch(console.error);
        }
      } else {
        setError(message);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(document: DocumentRecord) {
    const confirmed = window.confirm(
      `Delete "${document.filename}" permanently, including its stored file and indexed chunks?`
    );

    if (!confirmed) return;

    setError("");
    setStatus("");
    setDeletingId(document.id);

    try {
      const session = await getSession();

      if (!session) return;

      await apiRequest<{ deleted: boolean }>(
        `/api/v1/documents/${document.id}`,
        session.access_token,
        { method: "DELETE" }
      );

      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );

      setSelectedIds((current) =>
        current.filter((id) => id !== document.id)
      );

      setStatus(`Deleted "${document.filename}".`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete the document."
      );
    } finally {
      setDeletingId(null);
    }
  }


async function handleOpenSource(source: Source) {
  const document = documents.find(
    (item) => item.id === source.document_id
  );

  if (!document) {
    setError("The source document could not be found.");
    return;
  }

  // Open the tab directly from the click to avoid popup blocking.
  const previewTab = window.open("about:blank", "_blank");

  if (!previewTab) {
    setError("Allow pop-ups in your browser to open source documents.");
    return;
  }

  previewTab.opener = null;
  previewTab.document.title = "Opening document...";

  try {
    setError("");

    const session = await getSession();

    if (!session) {
      previewTab.close();
      return;
    }

    const result = await apiRequest<{
      signed_url: string;
      filename: string;
      mime_type: string;
      expires_in: number;
    }>(
      `/api/v1/documents/${source.document_id}/signed-url`,
      session.access_token
    );

    // PDF viewers commonly support opening a specific page.
    const pageFragment =
      result.mime_type === "application/pdf" &&
      source.page_number != null
        ? `#page=${source.page_number}`
        : "";

    previewTab.location.href = result.signed_url + pageFragment;
  } catch (err) {
    previewTab.close();

    setError(
      err instanceof Error
        ? err.message
        : "Could not open the source document."
    );
  }
}

  async function openConversation(conversationId: string) {
    if (loading) return;

    setLoading(true);
    setError("");
    setStatus("");

    try {
      const session = await getSession();

      if (!session) return;

      const result = await apiRequest<{
        messages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          citations: Source[] | null;
        }>;
      }>(
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
      const session = await getSession();

      if (!session) return;

      const result = await apiRequest<{
        conversation_id: string;
        answer: string;
        sources: Source[];
      }>("/api/v1/chat", session.access_token, {
        method: "POST",
        body: JSON.stringify({
          question: text,
          document_ids: selectedIds.length ? selectedIds : null,
          conversation_id: activeConversationId,
        }),
      });

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
    <main className="min-h-screen bg-gray-950 p-4 text-white md:p-6">
      <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">DocuLens AI</h1>
          <p className="mt-1 text-sm text-gray-400">
            Upload documents. Ask questions. Get cited answers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-400 sm:block">
            {email}
          </span>

          
  <button
    onClick={() => setSidebarOpen((open) => !open)}
    className="rounded-lg border border-gray-700 px-4 py-2 hover:bg-gray-800"
  >
  {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
  </button>

  <button
    onClick={handleLogout}
    className="rounded-lg border border-gray-700 px-4 py-2 hover:bg-gray-800"
  >
    Log out
  </button>

        </div>
      </header>

      {(status || error) && (
        <div
          role={error ? "alert" : "status"}
          className={`mx-auto mt-4 max-w-[1600px] break-words rounded-lg p-3 text-sm ${
            error
              ? "bg-red-950 text-red-200"
              : "bg-emerald-950 text-emerald-200"
          }`}
        >
          {error || status}
        </div>
      )}

      <div
        className={`mx-auto mt-6 grid max-w-[1600px] grid-cols-1 gap-5 ${
          sidebarOpen
            ? "lg:grid-cols-[320px_minmax(0,1fr)]"
            : "lg:grid-cols-1"
        }`}
      >             
        {sidebarOpen && (
        <aside className="space-y-5">
          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h2 className="text-lg font-semibold">Upload documents</h2>

            <p className="mt-1 text-sm text-gray-400">
              PDF, DOCX, PPTX or TXT · Up to 25 MB
            </p>

            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-700 p-6 text-center hover:border-blue-500">
              <span className="text-2xl" aria-hidden="true">
                +
              </span>
              <span className="mt-2 text-sm font-medium">
                {uploading ? "Processing document..." : "Choose a file"}
              </span>
              <span className="mt-1 text-xs text-gray-400">
                Your local AI will index its contents.
              </span>

              <input
                type="file"
                accept=".pdf,.docx,.pptx,.txt"
                disabled={uploading || deletingId !== null}
                onChange={handleUpload}
                className="sr-only"
              />
            </label>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">My documents</h2>
              <span className="text-xs text-gray-400">
                {documents.length} total
              </span>
            </div>

            <p className="mt-1 text-xs text-gray-400">
              Select the documents you want DocuLens to search.
            </p>

            <div className="mt-4 space-y-3">
              {documents.length === 0 && (
                <p className="text-sm text-gray-400">
                  No documents yet. Upload your first file above.
                </p>
              )}

              {documents.map((document) => (
                <div
                  key={document.id}
                  className="rounded-lg border border-gray-800 bg-gray-950 p-3"
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(document.id)}
                      disabled={document.status !== "ready"}
                      onChange={() => toggleDocument(document.id)}
                      className="mt-1 accent-blue-500"
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">
                        {document.filename}
                      </span>

                      <span className="mt-1 block text-xs text-gray-400">
                        {document.chunk_count ?? 0} chunks
                      </span>

                      <span
                        className={`mt-2 inline-block rounded-full px-2 py-1 text-xs ${
                          document.status === "ready"
                            ? "bg-emerald-950 text-emerald-300"
                            : document.status === "failed"
                              ? "bg-red-950 text-red-300"
                              : "bg-gray-800 text-gray-300"
                        }`}
                      >
                        {document.status}
                      </span>
                    </span>
                  </label>

                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => void handleDelete(document)}
                      disabled={
                        uploading ||
                        deletingId !== null ||
                        document.status === "processing"
                      }
                      className="rounded-md border border-red-900 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === document.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Chat history</h2>

              <button
                onClick={startNewChat}
                disabled={loading}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                + New chat
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {conversations.length === 0 && (
                <p className="text-sm text-gray-400">
                  Your saved conversations will appear here.
                </p>
              )}

              
{conversations.map((conversation) => (
  <div
    key={conversation.id}
    className={`flex items-start gap-2 rounded-lg p-2 ${
      activeConversationId === conversation.id
        ? "bg-gray-800 ring-1 ring-blue-500"
        : "bg-gray-950"
    }`}
  >
    <button
      onClick={() => void openConversation(conversation.id)}
      disabled={loading || deletingConversationId !== null}
      className="min-w-0 flex-1 rounded-md p-2 text-left text-sm hover:bg-gray-800 disabled:opacity-50"
    >
      <span className="block break-words font-medium">
        {conversation.title}
      </span>

      <span className="mt-1 block text-xs text-gray-500">
        {new Date(conversation.updated_at).toLocaleString()}
      </span>
    </button>

    <button
      onClick={() => void handleDeleteConversation(conversation)}
      disabled={loading || deletingConversationId !== null}
      title="Delete conversation"
      aria-label={`Delete conversation: ${conversation.title}`}
      className="shrink-0 rounded-md border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50"
    >
      {deletingConversationId === conversation.id ? "..." : "Delete"}
    </button>
  </div>
))}

            </div>
          </section>
        </aside>)}

        <section className="flex min-h-[650px] min-w-0 flex-col rounded-xl border border-gray-800 bg-gray-900 p-4 md:p-6">
          <div className="border-b border-gray-800 pb-4">
            <h2 className="text-xl font-semibold">Ask your documents</h2>
            <p className="mt-1 text-sm text-gray-400">
              Answers are generated locally and grounded in retrieved passages.
            </p>
          </div>

          <div className="flex-1 space-y-5 py-5">
            {messages.length === 0 && (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 p-6 text-center">
                <div className="text-4xl" aria-hidden="true">
                  ✦
                </div>
                <h3 className="mt-4 text-lg font-semibold">
                  What would you like to know?
                </h3>
                <p className="mt-2 max-w-md text-sm text-gray-400">
                  Upload a document on the left, select it, and ask a question.
                  DocuLens will retrieve relevant passages and show its sources.
                </p>
                <button
                  onClick={() =>
                    setQuestion(
                      "What are the main points in my selected documents?"
                    )
                  }
                  disabled={
                    documents.every((document) => document.status !== "ready")
                  }
                  className="mt-5 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 disabled:opacity-40"
                >
                  Try an example question
                </button>
              </div>
            )}

            {messages.map((message, index) => (
              <article
                key={message.id ?? `${index}-${message.role}`}
                className={`rounded-xl p-4 ${
                  message.role === "user"
                    ? "ml-3 bg-blue-950 md:ml-12"
                    : "mr-3 bg-gray-800 md:mr-12"
                }`}
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {message.role === "user" ? "You" : "DocuLens AI"}
                </p>

                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {message.content}
                </p>

                {message.sources && message.sources.length > 0 && (
                  <div className="mt-4 border-t border-gray-700 pt-4">
                    <h3 className="mb-3 text-sm font-semibold">
                      Sources and citations
                    </h3>

                    <div className="space-y-3">
                      {message.sources.map((source) => {
                        const document = documents.find(
                          (item) => item.id === source.document_id
                        );

                        return (
                          <div
                            key={`${index}-${source.source_id}`}
                            className="rounded-lg border border-gray-700 bg-gray-950 p-3"
                          >
                            <p className="break-words text-sm font-medium text-blue-300">
                              {source.source_id} ·{" "}
                              {document?.filename ?? "Document"}
                              {source.page_number != null
                                ? ` · Page ${source.page_number}`
                                : ""}
                            </p>

                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-300">
                              {source.excerpt}
                            </p>

                            <p className="mt-2 text-xs text-gray-500">
                              Similarity: {source.similarity.toFixed(3)}
                            </p>
                            
                          <button
                            onClick={() => void handleOpenSource(source)}
                            className="mt-3 rounded-lg border border-blue-700 px-3 py-2 text-sm text-blue-300 hover:bg-blue-950"
                          >
                            Open source
                            {source.page_number != null ? ` · Page ${source.page_number}` : ""}
                          </button>

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
                DocuLens is searching your documents and generating an answer...
              </p>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="sticky bottom-0 mt-4 space-y-3 border-t border-gray-800 bg-gray-900 pt-4"
          >
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about your documents..."
              rows={3}
              maxLength={4000}
              disabled={loading}
              className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                {selectedIds.length
                  ? `${selectedIds.length} document(s) selected`
                  : "Searching all ready documents"}
              </p>

              <button
                type="submit"
                disabled={
                  loading ||
                  !question.trim() ||
                  documents.every((document) => document.status !== "ready")
                }
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Thinking..." : "Ask DocuLens"}
              </button>
            </div>
          </form>

          <p className="mt-3 text-center text-xs text-gray-500">
            Powered by local Qwen and BGE-M3 models through Ollama.
          </p>
        </section>
      </div>
    </main>
  );
}
