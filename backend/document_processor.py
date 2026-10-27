
from document_parser import extract_document_sections
from chunker import chunk_document_sections
from embedding_service import generate_embedding
from supabase_client import supabase


BATCH_SIZE = 25


def process_document(document_id: str, user_id: str) -> dict:
    """
    Download, extract, chunk, embed, and index one owned document.

    The caller must authenticate the user before calling this function.
    Ownership is also checked against the document record.
    """

    result = (
        supabase.table("documents")
        .select("*")
        .eq("id", document_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise ValueError("Document not found or not owned by this user.")

    document = result.data[0]

    document_filter = (
        supabase.table("documents")
        .update({
            "status": "processing",
            "error_message": None,
        })
        .eq("id", document_id)
        .eq("user_id", user_id)
        .execute()
    )

    try:
        # Download the original file from private Supabase Storage.
        file_bytes = (
            supabase.storage
            .from_("documents")
            .download(document["storage_path"])
        )

        # Extract text and preserve source page/slide information.
        sections = extract_document_sections(
            document["filename"],
            file_bytes,
        )

        # Split extracted sections into manageable chunks.
        chunks = chunk_document_sections(sections)

        if not chunks:
            raise ValueError("No searchable text was extracted.")

        # Generate local embeddings.
        rows = []

        for chunk in chunks:
            embedding = generate_embedding(chunk["text"])

            rows.append({
                "document_id": document_id,
                "user_id": user_id,
                "chunk_index": chunk["chunk_index"],
                "content": chunk["text"],
                "page_number": chunk["page_number"],
                "embedding": embedding,
                "token_count": max(1, len(chunk["text"]) // 4),
            })

        # Remove old indexed chunks before saving the new index.
        (
            supabase.table("document_chunks")
            .delete()
            .eq("document_id", document_id)
            .eq("user_id", user_id)
            .execute()
        )

        # Insert in batches to keep requests manageable.
        for start in range(0, len(rows), BATCH_SIZE):
            batch = rows[start:start + BATCH_SIZE]

            (
                supabase.table("document_chunks")
                .insert(batch)
                .execute()
            )

        page_numbers = [
            section["page_number"]
            for section in sections
            if section.get("page_number") is not None
        ]

        # Mark the document ready only after indexing succeeds.
        (
            supabase.table("documents")
            .update({
                "status": "ready",
                "chunk_count": len(rows),
                "page_count": max(page_numbers) if page_numbers else None,
                "error_message": None,
            })
            .eq("id", document_id)
            .eq("user_id", user_id)
            .execute()
        )

        return {
            "document_id": document_id,
            "filename": document["filename"],
            "status": "ready",
            "section_count": len(sections),
            "chunk_count": len(rows),
            "embedding_dimensions": 1024,
        }

    except Exception as exc:
        # Avoid leaving a partially indexed document.
        try:
            (
                supabase.table("document_chunks")
                .delete()
                .eq("document_id", document_id)
                .eq("user_id", user_id)
                .execute()
            )

            (
                supabase.table("documents")
                .update({
                    "status": "failed",
                    "error_message": str(exc)[:1000],
                })
                .eq("id", document_id)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception:
            # Preserve the original processing error.
            pass

        raise
