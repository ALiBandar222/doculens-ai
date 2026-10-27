
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DocumentRecord = {
  id: string;
  filename: string;
  status: string;
  created_at: string;
  chunk_count?: number;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

export default function Dashboard() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [checking, setChecking] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const loadDocuments = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("documents")
      .select("id, filename, status, created_at, chunk_count")
      .eq("user_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load documents error:", error);
      setStatus(`Could not load documents: ${error.message}`);
      return;
    }

    setDocuments(data ?? []);
  }, []);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

      if (error || !data.session) {
        router.replace("/");
        return;
      }

      setUserId(data.session.user.id);
      setEmail(data.session.user.email ?? "");
      setChecking(false);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;

      if (!session) {
        router.replace("/");
      } else {
        setUserId(session.user.id);
        setEmail(session.user.email ?? "");
        setChecking(false);
      }
    });

    void checkSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (userId) {
      void loadDocuments(userId);
    }
  }, [userId, loadDocuments]);

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";

    if (!file || !userId) return;

    setStatus("");

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = MIME_TYPES[extension];

    if (!mimeType) {
      setStatus("Choose a PDF, DOCX, PPTX, or TXT file.");
      return;
    }

    if (file.size === 0) {
      setStatus("The selected file is empty.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setStatus("The maximum file size is 25 MB.");
      return;
    }

    setUploading(true);

    const storagePath =
      `${userId}/${crypto.randomUUID()}/` +
      file.name.replace(/[^\w.\- ()]/g, "_");

    let documentCreated = false;

    try {
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
        const { error: cleanupError } = await supabase.storage
          .from("documents")
          .remove([storagePath]);

        if (cleanupError) {
          console.error("Storage cleanup failed:", cleanupError);
        }

        throw databaseError;
      }

      documentCreated = true;
      setDocuments((current) => [document, ...current]);
      setStatus("Upload successful. Processing your document...");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const response = await fetch(
        `${API_URL}/api/v1/documents/${document.id}/process`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : `Processing failed with HTTP ${response.status}.`
        );
      }

      setStatus(
        `Success! ${result.filename} processed into ${result.chunk_count} chunks.`
      );

      await loadDocuments(userId);
    } catch (error) {
      console.error("Upload or processing error:", error);

      const message =
        error instanceof Error ? error.message : String(error);

      setStatus(
        documentCreated
          ? `File uploaded, but processing failed: ${message}`
          : `Upload failed: ${message}`
      );

      if (documentCreated) {
        await loadDocuments(userId);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(document: DocumentRecord) {
    const confirmed = window.confirm(
      `Delete "${document.filename}" permanently? Its stored file and indexed chunks will also be removed.`
    );

    if (!confirmed) return;

    setStatus("");
    setDeletingId(document.id);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        router.replace("/");
        return;
      }

      const response = await fetch(
        `${API_URL}/api/v1/documents/${document.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : `Deletion failed with HTTP ${response.status}.`
        );
      }

      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );

      setStatus(`Deleted "${document.filename}" successfully.`);
    } catch (error) {
      console.error("Document deletion error:", error);

      setStatus(
        `Could not delete document: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setStatus(`Logout failed: ${error.message}`);
      return;
    }

    router.replace("/");
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        Checking your session...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">DocuLens AI</h1>

        <div className="flex gap-2">
          <button
            onClick={() => router.push("/chat")}
            className="rounded-lg bg-blue-600 px-4 py-2 hover:bg-blue-700"
          >
            Ask DocuLens
          </button>

          <button
            onClick={handleLogout}
            disabled={uploading || deletingId !== null}
            className="rounded-lg border border-gray-700 px-4 py-2 hover:bg-gray-800 disabled:opacity-50"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="mx-auto mt-12 max-w-5xl">
        <p className="text-sm text-blue-400">YOUR WORKSPACE</p>

        <h2 className="mt-3 text-3xl font-bold">
          Welcome to DocuLens AI
        </h2>

        <p className="mt-2 break-all text-gray-400">{email}</p>

        <div className="mt-10 rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="text-xl font-semibold">Upload a document</h3>

          <p className="mt-2 text-sm text-gray-400">
            PDF, Word, PowerPoint, or TXT. Maximum size: 25 MB.
          </p>

          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-700 p-8 text-center hover:border-blue-500">
            <span className="font-medium">
              {uploading ? "Uploading and processing..." : "Choose a file"}
            </span>

            <span className="mt-2 text-sm text-gray-400">
              Your document will be processed by your local AI.
            </span>

            <input
              type="file"
              accept=".pdf,.docx,.pptx,.txt"
              disabled={uploading || deletingId !== null}
              onChange={handleUpload}
              className="sr-only"
            />
          </label>

          {status && (
            <p
              aria-live="polite"
              className="mt-4 break-words rounded-lg bg-gray-800 p-3 text-sm"
            >
              {status}
            </p>
          )}
        </div>

        <div className="mt-8">
          <h3 className="text-xl font-semibold">Your documents</h3>

          {documents.length === 0 ? (
            <p className="mt-4 text-gray-400">
              No documents uploaded yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {documents.map((document) => (
                <div
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-medium">
                      {document.filename}
                    </p>

                    <p className="mt-1 text-sm text-gray-400">
                      {new Date(document.created_at).toLocaleString()}
                    </p>

                    <p className="mt-1 text-sm text-gray-400">
                      Chunks: {document.chunk_count ?? 0}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-gray-800 px-3 py-1 text-sm">
                      {document.status}
                    </span>

                    <button
                      onClick={() => void handleDelete(document)}
                      disabled={
                        uploading ||
                        deletingId !== null ||
                        document.status === "processing"
                      }
                      className="rounded-lg border border-red-800 px-3 py-2 text-sm text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === document.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
