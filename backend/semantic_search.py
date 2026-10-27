
from uuid import UUID

from embedding_service import generate_embedding
from supabase_client import supabase


def search_documents(
    query: str,
    user_id: str,
    document_ids: list[str] | None = None,
    match_count: int = 5,
) -> list[dict]:
    """
    Search the current user's indexed documents by semantic similarity.

    The user_id must come from a verified authentication session,
    not directly from untrusted frontend input.
    """

    if not query or not query.strip():
        raise ValueError("Search query cannot be empty.")

    # Validate IDs before making a database request.
    UUID(user_id)

    if document_ids is not None:
        for document_id in document_ids:
            UUID(document_id)

    match_count = max(1, min(match_count, 20))

    # Convert the question into a 1024-dimensional local embedding.
    query_embedding = generate_embedding(query.strip())

    # Ask Supabase to find the nearest document chunks.
    response = supabase.rpc(
        "match_document_chunks",
        {
            "p_query_embedding": query_embedding,
            "p_user_id": user_id,
            "p_document_ids": document_ids,
            "p_match_count": match_count,
        },
    ).execute()

    return response.data or []
