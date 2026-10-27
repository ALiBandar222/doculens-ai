
-- ============================================================
-- DocuLens AI - Database Schema
-- PostgreSQL + Supabase + pgvector
--
-- Intended for a fresh Supabase project.
-- Do not run against an existing installation without reviewing
-- the existing tables, policies, and Storage configuration.
-- ============================================================


-- ============================================================
-- 1. EXTENSIONS AND SCHEMAS
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS vector
WITH SCHEMA extensions;


-- ============================================================
-- 2. DOCUMENTS
-- Stores uploaded document metadata.
-- The original files live in private Supabase Storage.
-- ============================================================

CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,

    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'failed')),

    page_count INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 3. DOCUMENT CHUNKS
-- Stores extracted passages and BGE-M3 embeddings.
-- BGE-M3 produces 1024-dimensional vectors in this project.
-- ============================================================

CREATE TABLE public.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    document_id UUID NOT NULL
        REFERENCES public.documents(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,

    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page_number INTEGER,

    embedding extensions.vector(1024),
    token_count INTEGER,

    CONSTRAINT document_chunks_unique_position
        UNIQUE (document_id, chunk_index)
);


-- ============================================================
-- 4. CONVERSATIONS
-- Stores each user's chat sessions.
-- ============================================================

CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,

    title TEXT NOT NULL DEFAULT 'New conversation',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 5. MESSAGES
-- Stores user questions, assistant answers, and citations.
-- ============================================================

CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL
        REFERENCES public.conversations(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,

    role TEXT NOT NULL
        CHECK (role IN ('user', 'assistant')),

    content TEXT NOT NULL,

    citations JSONB NOT NULL DEFAULT '[]'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 6. INDEXES
-- Improve common ownership, history, and document lookups.
-- ============================================================

CREATE INDEX documents_user_created_idx
    ON public.documents (user_id, created_at DESC);

CREATE INDEX document_chunks_user_idx
    ON public.document_chunks (user_id);

CREATE INDEX conversations_user_updated_idx
    ON public.conversations (user_id, updated_at DESC);

CREATE INDEX messages_conversation_created_idx
    ON public.messages (conversation_id, created_at);


-- ============================================================
-- 7. ROW LEVEL SECURITY
-- Users may access only records belonging to themselves.
-- ============================================================

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;


-- Documents

CREATE POLICY "Users manage their own documents"
ON public.documents
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));


-- Document chunks

CREATE POLICY "Users access their own chunks"
ON public.document_chunks
FOR ALL
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
        SELECT 1
        FROM public.documents AS d
        WHERE d.id = document_id
          AND d.user_id = (SELECT auth.uid())
    )
)
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
        SELECT 1
        FROM public.documents AS d
        WHERE d.id = document_id
          AND d.user_id = (SELECT auth.uid())
    )
);


-- Conversations

CREATE POLICY "Users manage their own conversations"
ON public.conversations
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));


-- Messages

CREATE POLICY "Users manage their own messages"
ON public.messages
FOR ALL
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
        SELECT 1
        FROM public.conversations AS c
        WHERE c.id = conversation_id
          AND c.user_id = (SELECT auth.uid())
    )
)
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
        SELECT 1
        FROM public.conversations AS c
        WHERE c.id = conversation_id
          AND c.user_id = (SELECT auth.uid())
    )
);


-- ============================================================
-- 8. DATABASE PRIVILEGES
-- SQL privileges and RLS policies are both required.
-- The service_role credential must remain backend-only.
-- ============================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE
    public.documents,
    public.document_chunks,
    public.conversations,
    public.messages
TO authenticated, service_role;


-- ============================================================
-- 9. PRIVATE DOCUMENT STORAGE BUCKET
-- 25 MB maximum; only supported document MIME types.
-- ============================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'documents',
    'documents',
    FALSE,
    26214400,
    ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain'
    ]
)
ON CONFLICT (id) DO NOTHING;


-- Storage access is limited to the authenticated user's
-- first-level folder, which must equal their Supabase user ID.

CREATE POLICY "Users manage their own document files"
ON storage.objects
FOR ALL
TO authenticated
USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
)
WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
);


-- ============================================================
-- 10. SEMANTIC SEARCH FUNCTION
-- Returns the closest document chunks by cosine similarity.
-- Intended for the trusted backend service_role client.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_document_chunks(
    p_query_embedding extensions.vector(1024),
    p_user_id UUID,
    p_document_ids UUID[] DEFAULT NULL,
    p_match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    page_number INTEGER,
    similarity DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
SET search_path = public, extensions
AS $$
    SELECT
        dc.id,
        dc.document_id,
        dc.content,
        dc.page_number,
        1 - (
            dc.embedding OPERATOR(extensions.<=>)
            p_query_embedding
        ) AS similarity
    FROM public.document_chunks AS dc
    WHERE dc.user_id = p_user_id
      AND dc.embedding IS NOT NULL
      AND (
          p_document_ids IS NULL
          OR dc.document_id = ANY(p_document_ids)
      )
    ORDER BY
        dc.embedding OPERATOR(extensions.<=>)
        p_query_embedding
    LIMIT LEAST(GREATEST(COALESCE(p_match_count, 5), 1), 20);
$$;


-- Restrict direct function execution to the trusted backend role.

REVOKE ALL ON FUNCTION public.match_document_chunks(
    extensions.vector, UUID, UUID[], INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(
    extensions.vector, UUID, UUID[], INTEGER
) TO service_role;
