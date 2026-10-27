
def chunk_document_sections(
    sections: list[dict],
    chunk_size: int = 2400,
    overlap: int = 400,
) -> list[dict]:
    """
    Split extracted document sections into smaller chunks.

    Defaults:
        chunk_size: approximately 600 tokens
        overlap: approximately 100 tokens

    Page numbers and source locations are preserved.
    Character counts are approximate substitutes for token counts.
    """

    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive.")

    if overlap < 0 or overlap >= chunk_size:
        raise ValueError(
            "overlap must be non-negative and smaller than chunk_size."
        )

    chunks = []

    for section in sections:
        text = section["text"].strip()

        if not text:
            continue

        start = 0

        while start < len(text):
            end = min(start + chunk_size, len(text))

            # Prefer ending at a paragraph or word boundary.
            if end < len(text):
                search_start = start + (chunk_size * 2 // 3)

                newline = text.rfind("\n", search_start, end)
                space = text.rfind(" ", search_start, end)
                boundary = max(newline, space)

                if boundary > start:
                    end = boundary

            chunk_text = text[start:end].strip()

            if chunk_text:
                chunks.append({
                    "chunk_index": len(chunks),
                    "text": chunk_text,
                    "page_number": section.get("page_number"),
                    "location_label": section.get("location_label"),
                })

            if end >= len(text):
                break

            # Move forward while retaining some context.
            start = max(start + 1, end - overlap)

    return chunks
