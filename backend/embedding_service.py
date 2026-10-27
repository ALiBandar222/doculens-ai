
import ollama

EMBEDDING_MODEL = "bge-m3"
EXPECTED_DIMENSIONS = 1024


def generate_embedding(text: str) -> list[float]:
    """
    Generate a semantic embedding using the local BGE-M3 model.
    No external AI API is required.
    """

    if not text or not text.strip():
        raise ValueError("Cannot generate an embedding for empty text.")

    response = ollama.embeddings(
        model=EMBEDDING_MODEL,
        prompt=text,
    )

    embedding = response.embedding

    if len(embedding) != EXPECTED_DIMENSIONS:
        raise ValueError(
            f"Expected {EXPECTED_DIMENSIONS} dimensions, "
            f"but received {len(embedding)}."
        )

    return embedding
