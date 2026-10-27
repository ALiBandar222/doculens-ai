
from types import SimpleNamespace

import answer_generator
from chunker import chunk_document_sections
from document_parser import extract_document_sections


def test_txt_extraction_preserves_text():
    sections = extract_document_sections(
        "sample.txt",
        b"Hello DocuLens AI",
    )

    assert len(sections) == 1
    assert sections[0]["text"] == "Hello DocuLens AI"
    assert sections[0]["page_number"] is None


def test_chunking_preserves_page_number():
    sections = [
        {
            "text": "A" * 5000,
            "page_number": 3,
            "location_label": "Page 3",
        }
    ]

    chunks = chunk_document_sections(sections)

    assert len(chunks) > 1
    assert all(chunk["page_number"] == 3 for chunk in chunks)
    assert chunks[0]["chunk_index"] == 0
    assert chunks[1]["chunk_index"] == 1


def test_irrelevant_question_returns_no_sources(monkeypatch):
    monkeypatch.setattr(
        answer_generator,
        "search_documents",
        lambda **kwargs: [
            {
                "document_id": "doc-1",
                "content": "This is an unrelated worksheet.",
                "page_number": 1,
                "similarity": 0.20,
            }
        ],
    )

    def unexpected_llm_call(**kwargs):
        raise AssertionError(
            "The LLM should not run when all retrieved chunks are irrelevant."
        )

    monkeypatch.setattr(
        answer_generator.ollama,
        "chat",
        unexpected_llm_call,
    )

    result = answer_generator.answer_question(
        question="What is the capital of Japan?",
        user_id="test-user",
    )

    assert "couldn't find enough relevant information" in result["answer"]
    assert result["sources"] == []


def test_relevant_question_returns_cited_sources(monkeypatch):
    monkeypatch.setattr(
        answer_generator,
        "search_documents",
        lambda **kwargs: [
            {
                "document_id": "doc-1",
                "content": "Week 10: Learn cloud basics and deploy an application.",
                "page_number": 3,
                "similarity": 0.70,
            }
        ],
    )

    monkeypatch.setattr(
        answer_generator.ollama,
        "chat",
        lambda **kwargs: SimpleNamespace(
            message=SimpleNamespace(
                content="Learn cloud basics and deploy an application. [S1]"
            )
        ),
    )

    result = answer_generator.answer_question(
        question="What should I learn in week 10?",
        user_id="test-user",
    )

    assert "cloud basics" in result["answer"]
    assert len(result["sources"]) == 1
    assert result["sources"][0]["source_id"] == "S1"
    assert result["sources"][0]["page_number"] == 3
