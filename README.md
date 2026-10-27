# DocuLens AI

**A full-stack AI document assistant with local LLMs, multilingual semantic search, and source citations.**

DocuLens AI allows users to upload documents, ask questions in natural language, and receive answers grounded in retrieved document passages. It combines a Next.js frontend, a FastAPI backend, Supabase, and locally running AI models through Ollama.

The project explores retrieval-augmented generation (RAG), vector search, document processing, authentication, and evidence-grounded AI responses without requiring paid OpenAI API calls.

## Features

- **Multi-format document uploads:** PDF, Microsoft Word (DOCX), PowerPoint (PPTX), and TXT.
- **English and Arabic support:** Extract text from English and Arabic documents using Unicode-compatible document parsers.
- **Arabic PDF OCR:** Use Tesseract OCR with Arabic language data when PDF text extraction appears unreliable.
- **Authentication:** Email/password signup, email confirmation, and login through Supabase Auth.
- **Private document storage:** Store uploaded files in a private Supabase Storage bucket.
- **Document processing:** Extract text, split it into chunks, preserve page or slide metadata where supported, and generate embeddings.
- **Local language model:** Generate answers with Qwen 2.5 3B through Ollama.
- **Multilingual semantic search:** Use BGE-M3 embeddings and pgvector to retrieve relevant passages.
- **Source citations:** Return supporting excerpts, document names, and page numbers.
- **Persistent conversations:** Save questions, answers, conversation history, and citation metadata in PostgreSQL.
- **Document management:** Upload and delete documents.
- **Insufficient-evidence handling:** Return a fallback response when retrieved chunks do not meet the configured similarity threshold.
- **Automated tests:** Test extraction, chunking, fallback behavior, and source metadata.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Python, FastAPI |
| Database | PostgreSQL, Supabase |
| Authentication | Supabase Auth |
| File storage | Supabase Storage |
| Vector search | pgvector |
| Answer generation | Qwen 2.5 3B, Ollama |
| Embeddings | BGE-M3, Ollama |
| Document parsing | PyMuPDF, python-docx, python-pptx |
| OCR | Tesseract OCR, pytesseract, Pillow |
| Testing | pytest |

## Architecture

```text
User
 |
 v
Next.js + TypeScript
 |
 +---- Supabase Auth
 |
 +---- Private document uploads
 |
 +---- Authenticated API requests
          |
          v
     FastAPI backend
          |
          +---- Verify Supabase access token
          |
          +---- Check document ownership
          |
          +---- Download private documents
          |
          +---- Extract text and perform OCR
          |
          +---- Split text into chunks
          |
          +---- Generate BGE-M3 embeddings
          |
          +---- Store chunks in PostgreSQL/pgvector
          |
          +---- Retrieve relevant passages
          |
          +---- Generate answers with Qwen
          |
          v
     Answer + source citations
```

## How RAG works

DocuLens AI uses retrieval-augmented generation to answer questions from uploaded documents.

1. **Upload:** A user uploads a PDF, DOCX, PPTX, or TXT file.
2. **Extract:** The backend extracts text. PDFs retain page numbers, PowerPoint slides retain slide numbers, and Arabic OCR can be used when PDF text extraction is unreliable.
3. **Chunk:** The extracted text is divided into smaller passages with source metadata.
4. **Embed:** BGE-M3 converts each passage into a 1,024-dimensional vector.
5. **Store:** Supabase PostgreSQL stores the passages and embeddings using pgvector.
6. **Retrieve:** A user's question is converted into an embedding, and the database retrieves semantically similar passages.
7. **Generate:** Qwen 2.5 3B generates an answer using the retrieved context.
8. **Cite:** The application displays the answer with supporting excerpts and source locations.

The answer generator uses a configurable similarity threshold to filter weak retrieval results. Similarity scores are not probabilities of correctness, and further evaluation is needed to tune the threshold across different documents and languages.

## Database design

The application uses four PostgreSQL tables.

| Table | Purpose |
|---|---|
| `documents` | Stores document metadata, ownership, processing status, storage path, and chunk counts. |
| `document_chunks` | Stores extracted text, chunk indices, source page numbers, and 1,024-dimensional embeddings. |
| `conversations` | Stores conversation titles, ownership, and timestamps. |
| `messages` | Stores user questions, AI answers, and source citation metadata. |

### Relationships

- Each document belongs to a user.
- Each document can have multiple chunks.
- Each conversation belongs to a user.
- Each conversation can have multiple messages.
- Deleting a document cascades to its indexed chunks through the configured foreign-key relationship.

### Database initialization

**Current implementation:** The tables, Row Level Security policies, vector extension, database privileges, and `match_document_chunks` function were configured manually through the Supabase SQL Editor during development.

They are not yet automatically generated by an application migration system.

Automated, version-controlled database migrations are a planned improvement so that a fresh environment can recreate the schema consistently.

### Security

- Row Level Security restricts user access to owned database records.
- The Storage bucket is private.
- The backend verifies Supabase access tokens and checks document ownership before processing.
- The privileged Supabase backend key is kept on the server and must never be exposed to the browser.

## Supported document formats

| Format | Text extraction | Source location |
|---|---|---|
| PDF | English and Arabic text; Arabic OCR fallback when needed | PDF page |
| DOCX | English and Arabic paragraphs and tables | Document-level location; Word pagination is not currently preserved |
| PPTX | English and Arabic slide text and tables | Slide number |
| TXT | UTF-8 text | Document-level location |

**Important limitation:** OCR quality depends on scan quality, page layout, and language recognition. The current OCR configuration is optimized for Arabic PDFs; scanned English PDFs may require additional OCR configuration. Complex layouts and tables can also produce imperfect extraction.

## Getting started

### Prerequisites

- Windows 10/11 or another compatible operating system.
- Python 3.10 or newer.
- Node.js and npm.
- Git.
- [Ollama](https://ollama.com/download).
- A [Supabase](https://supabase.com/) project.
- [Tesseract OCR for Windows](https://github.com/UB-Mannheim/tesseract/wiki), including Arabic (`ara`) language data for Arabic OCR.

Local model performance depends on available RAM, CPU, GPU, and model configuration.

### 1. Clone the repository

```bash
git clone https://github.com/ALiBandar222/doculens-ai.git
cd doculens-ai
```

### 2. Install the local AI models

Install Ollama, then run:

```powershell
ollama pull qwen2.5:3b
ollama pull bge-m3
ollama list
```

Both models must be available in Ollama before testing document processing or chat.

### 3. Configure Supabase

Create a Supabase project and configure:

- The four tables described in the database section.
- The `vector` extension.
- A 1,024-dimensional embedding column.
- The `match_document_chunks` function.
- Row Level Security policies and the required database privileges.
- A private Storage bucket named `documents`.
- Storage policies that restrict file access to the owning user.

The current database setup is manual. A schema migration file is planned to make this process easier to reproduce.

### 4. Configure backend environment variables

Create `backend/.env`:

```dotenv
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-secret-key
```

Replace the example values with your actual Supabase credentials.

The backend secret key is privileged. Keep it out of the frontend, source code, logs, and Git history.

### 5. Install and run the backend

From the project root, create the virtual environment:

```powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

Make sure `backend/.env` is configured before starting the server.

For Arabic OCR on Windows, the current parser expects Tesseract at:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Start FastAPI:

```powershell
cd backend
python -m uvicorn main:app --reload
```

The backend runs at `http://127.0.0.1:8000`.

Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### 6. Configure and run the frontend

Create `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Install dependencies:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

### 7. Use the application

1. Create an account and confirm your email if required.
2. Open `/dashboard` to upload and manage documents.
3. Wait until document processing completes and the status becomes `ready`.
4. Open `/chat` to select documents and ask questions.
5. Review the answer and its source citations.
6. Reopen saved conversations from the conversation history.

The dashboard and chat pages link to each other. Automatic redirection from login to the dashboard and a more unified onboarding flow remain planned improvements.

## Testing

Run the automated tests from the backend directory with the virtual environment activated:

```powershell
python -m pytest -q
```

The current test suite covers:

- TXT extraction.
- Chunking and page-number preservation.
- Insufficient-evidence fallback behavior.
- Answer generation and source metadata.

The suite currently contains four tests and mocks retrieval or model calls where appropriate. It does not yet represent a comprehensive end-to-end evaluation of answer accuracy.

## Known limitations

- Arabic OCR can still misrecognize characters, diacritics, and complex page layouts.
- Scanned English PDFs need additional OCR configuration.
- Word pagination is not preserved by the current DOCX parser.
- The retrieval similarity threshold requires a larger evaluation benchmark.
- Long-running document processing currently runs synchronously.
- Database initialization is manual rather than migration-based.
- Authentication-to-dashboard navigation and onboarding need further integration.
- The application is a portfolio MVP and is not yet production-hardened.

## Roadmap

- Add versioned database migrations.
- Connect login, upload, and chat into a smoother user journey.
- Improve Arabic and English OCR for scanned PDFs.
- Build a retrieval and answer-quality evaluation benchmark.
- Add durable background processing for larger documents.
- Improve retrieval with hybrid search and reranking.
- Add streaming responses and a document viewer.
- Deploy the frontend and backend with production security configuration.

## Author

**Ali Bandar**

GitHub: [@ALiBandar222](https://github.com/ALiBandar222)

Repository: [DocuLens AI](https://github.com/ALiBandar222/doculens-ai)

---

Built as a full-stack AI portfolio project exploring document processing, multilingual retrieval-augmented generation, vector search, authentication, and local language models.
