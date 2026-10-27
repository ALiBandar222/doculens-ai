# DocuLens AI

**A full-stack AI document assistant with local language models, multilingual semantic search, and source citations.**

DocuLens AI allows users to upload documents, ask questions in natural language, and receive answers grounded in retrieved document passages. It combines a Next.js frontend, a FastAPI backend, Supabase, PostgreSQL with pgvector, and locally running AI models through Ollama.

The project demonstrates full-stack development, retrieval-augmented generation (RAG), vector search, document processing, authentication, database design, and evidence-grounded AI responses without requiring paid OpenAI API calls.

## Features

### Document management
- Upload PDF, Microsoft Word (DOCX), PowerPoint (PPTX), and TXT files.
- Extract English and Arabic text from supported document formats.
- Use Arabic-focused Tesseract OCR when PDF text appears empty or unreliable.
- Preserve PDF page numbers and PowerPoint slide numbers where supported.
- Automatically process uploads into searchable chunks and embeddings.
- Display processing status and indexed chunk counts.
- Delete documents and their associated indexed chunks.

### AI and semantic search
- Generate answers using Qwen 2.5 3B through Ollama.
- Generate multilingual embeddings using BGE-M3.
- Store 1,024-dimensional vectors in PostgreSQL with pgvector.
- Retrieve semantically similar passages rather than relying only on exact keyword matches.
- Display source excerpts, document filenames, page numbers, and similarity scores.
- Filter weak retrieval results using a configurable similarity threshold.
- Return an insufficient-evidence response when no retrieved passages meet the configured threshold.
- Run embedding generation and answer generation locally without OpenAI API calls.

### Unified workspace
- Email/password signup and login through Supabase Auth.
- Redirect users to the dashboard after successful login or signup when an authenticated session is available.
- Upload documents and ask questions from one unified workspace.
- Hide or show the sidebar to give the chat more screen space.
- Select which documents to search.
- Display AI answers alongside supporting sources.
- Save conversations, messages, and citation metadata in PostgreSQL.
- Reopen previous conversations after refreshing the browser.
- Delete individual conversations and their associated messages.
- Delete documents from the workspace.

### Testing
- Automated backend tests using pytest.
- Frontend code checks using ESLint.
- Tests covering text extraction, chunking, insufficient-evidence handling, and source metadata.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Python, FastAPI |
| Database | PostgreSQL through Supabase |
| Authentication | Supabase Auth |
| File storage | Supabase Storage |
| Vector search | pgvector |
| Language model | Qwen 2.5 3B through Ollama |
| Embeddings | BGE-M3 through Ollama |
| PDF extraction | PyMuPDF |
| Word extraction | python-docx |
| PowerPoint extraction | python-pptx |
| OCR | Tesseract OCR, pytesseract, Pillow |
| Testing | pytest, ESLint |

## Architecture

```text
Browser
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
             +---- Verify access token
             |
             +---- Validate document ownership
             |
             +---- Download private documents
             |
             +---- Extract text and perform OCR
             |
             +---- Split text into chunks
             |
             +---- Generate BGE-M3 embeddings
             |
             +---- Store chunks and vectors
             |
             +---- Retrieve relevant passages
             |
             +---- Generate answers with Qwen
             |
             +---- Save conversations and citations
             |
             v
       Answer + source citations
```

## Database design

DocuLens AI uses four PostgreSQL tables to store document metadata, extracted passages, vector embeddings, conversation history, and AI responses.

### 1. `documents`

Stores metadata about uploaded documents.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique document identifier |
| `user_id` | UUID, foreign key | Document owner, referencing `auth.users(id)` |
| `filename` | TEXT | Original uploaded filename |
| `storage_path` | TEXT | Path to the private Storage object |
| `mime_type` | TEXT | Document MIME type |
| `status` | TEXT | Processing state: `processing`, `ready`, or `failed` |
| `page_count` | INTEGER, nullable | Number of pages or source pages when available |
| `chunk_count` | INTEGER | Number of indexed chunks |
| `error_message` | TEXT, nullable | Processing error details |
| `created_at` | TIMESTAMPTZ | Record creation timestamp |

**Design decision:** Original files are stored in Supabase Storage, while PostgreSQL stores their paths and metadata. The status field tracks document processing progress.

### 2. `document_chunks`

Stores extracted text passages and their semantic embeddings.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique chunk identifier |
| `document_id` | UUID, foreign key | References `documents(id)` |
| `user_id` | UUID, foreign key | Identifies the owner |
| `chunk_index` | INTEGER | Position of the chunk within its document |
| `content` | TEXT | Extracted text passage |
| `page_number` | INTEGER, nullable | Source page or slide where available |
| `embedding` | `vector(1024)` | BGE-M3 semantic embedding |
| `token_count` | INTEGER, nullable | Approximate chunk-size metadata |

A unique constraint on `(document_id, chunk_index)` prevents duplicate chunk positions within a document.

**Design decision:** Text is split into smaller passages so semantic search can retrieve relevant sections rather than loading entire documents. The 1,024-dimensional vector format matches the local BGE-M3 embedding model.

### 3. `conversations`

Stores chat sessions.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique conversation identifier |
| `user_id` | UUID, foreign key | Conversation owner |
| `title` | TEXT | Conversation title |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last activity timestamp |

Conversation titles are initialized from the first question when a conversation is created through the chat API.

### 4. `messages`

Stores user questions, AI answers, and citation metadata.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique message identifier |
| `conversation_id` | UUID, foreign key | References `conversations(id)` |
| `user_id` | UUID, foreign key | Identifies the owner |
| `role` | TEXT | `user` or `assistant` |
| `content` | TEXT | Message content |
| `citations` | JSONB | Source identifiers, excerpts, page numbers, and similarity metadata |
| `created_at` | TIMESTAMPTZ | Message creation timestamp |

**Design decision:** Citation metadata is stored with assistant messages so sources can be restored when a conversation is reopened.

### Database relationships

```text
auth.users
  |
  +---- documents
  |        |
  |        +---- document_chunks
  |
  +---- conversations
           |
           +---- messages
```

- Each document belongs to a user.
- Each document can contain multiple chunks.
- Each conversation belongs to a user.
- Each conversation can contain multiple messages.
- Foreign keys enforce relationships between records.
- Row Level Security (RLS) policies restrict access to user-owned data.
- Cascading relationships are configured for associated records.

### How the database was created

The initial database schema was created manually in the Supabase SQL Editor during development.

The schema is documented in [`backend/database/schema.sql`](backend/database/schema.sql).

The SQL file describes:
- The four application tables and their relationships.
- Primary keys, foreign keys, constraints, and indexes.
- Row Level Security policies.
- Database privileges.
- The private Supabase Storage bucket and its access policy.
- The `match_document_chunks` semantic-search function.
- The 1,024-dimensional vector column used by BGE-M3.

**Important:** The schema script is intended for a fresh Supabase project. Do not run it against an existing installation without reviewing its current tables and policies. The existing project was configured manually; a versioned database migration system is a planned improvement.

## How the AI pipeline works

DocuLens AI uses retrieval-augmented generation (RAG) to answer questions using uploaded documents.

1. **Upload:** A user uploads a PDF, DOCX, PPTX, or TXT file.
2. **Store:** The original file is uploaded to a private Supabase Storage bucket.
3. **Register:** A document record is created in PostgreSQL.
4. **Extract:** FastAPI downloads the stored file and extracts its text.
5. **OCR:** Arabic-focused Tesseract OCR is used when PDF text appears empty or unreliable.
6. **Chunk:** Extracted text is divided into passages with source-location metadata.
7. **Embed:** BGE-M3 generates a 1,024-dimensional embedding for each passage.
8. **Index:** Text chunks and embeddings are saved to PostgreSQL with pgvector.
9. **Retrieve:** The user's question is embedded locally, and the database retrieves semantically similar passages.
10. **Generate:** Qwen 2.5 3B generates an answer using the retrieved context.
11. **Cite:** The response includes supporting excerpts and source locations.
12. **Persist:** Questions, answers, and citation metadata are saved to conversation history.

The similarity threshold is a retrieval filter, not a probability of correctness. Its effectiveness should be evaluated against a larger collection of relevant and irrelevant questions.

## Supported document formats

| Format | Text extraction | Source locations |
|---|---|---|
| PDF | English and Arabic embedded text; Arabic OCR fallback when needed | PDF page |
| DOCX | English and Arabic paragraphs and tables | Document-level location |
| PPTX | English and Arabic slide text and tables | Slide number |
| TXT | UTF-8 text | Document-level location |

**Current limitation:** Arabic OCR quality depends on scan quality, layout, and recognition accuracy. The current OCR configuration is optimized for Arabic PDFs; scanned English PDFs may require additional OCR configuration. DOCX pagination is not currently preserved.

## Getting started

### Prerequisites

- Python 3.10 or newer.
- Node.js and npm.
- Git.
- [Ollama](https://ollama.com/download).
- A [Supabase](https://supabase.com/) project.
- [Tesseract OCR for Windows](https://github.com/UB-Mannheim/tesseract/wiki), including Arabic (`ara`) language data for Arabic OCR.

Local model performance depends on available RAM, CPU, GPU, and model configuration.

### 1. Clone the repository

```powershell
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

Both models must be available in Ollama before document processing or chat will work.

### 3. Configure Supabase

Create a Supabase project and configure:
- The four application tables described above.
- The PostgreSQL `vector` extension.
- The `extensions.vector(1024)` embedding column.
- The `match_document_chunks` function.
- Row Level Security policies and database privileges.
- A private Storage bucket named `documents`.
- Storage policies restricting file access to the owning user's folder.

The database was configured manually during development. The repository contains a schema SQL file for reference and fresh-project setup; it is not yet a versioned migration system.

### 4. Configure backend environment variables

Create `backend/.env`:

```dotenv
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-secret-key
```

Replace the example values with your actual Supabase credentials.

The backend secret key is privileged. Keep it out of frontend code, source control, and public logs.

### 5. Install and run the backend

From the project root, create a Python virtual environment and install dependencies:

```powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

For Arabic OCR on Windows, ensure Tesseract is installed with Arabic language data. The current parser expects:

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

Install dependencies and start Next.js:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

### 7. Use DocuLens AI

1. Sign up or log in.
2. Upload a PDF, DOCX, PPTX, or TXT file from the unified workspace.
3. Wait until processing finishes and the document status becomes `ready`.
4. Select the documents you want to search.
5. Ask a question and review the answer and citations.
6. Hide or show the sidebar as needed.
7. Reopen previous conversations or delete conversations you no longer need.

## Testing

### Backend

From the backend directory, with the virtual environment activated:

```powershell
python -m pytest -q
```

The current suite contains four automated tests covering:
- TXT extraction.
- Chunking and page-number preservation.
- Insufficient-evidence fallback behavior.
- Answer generation and source metadata.

These tests do not yet constitute a comprehensive end-to-end evaluation of answer accuracy.

### Frontend

From the frontend directory:

```powershell
npm run lint
```

## Security considerations

- Never commit `.env` or `.env.local` files.
- Keep the privileged Supabase key exclusively on the backend.
- Verify authentication and document ownership before processing or deleting documents.
- Keep the Storage bucket private.
- Treat uploaded document contents as untrusted input.
- Review authorization policies before deploying the application publicly.

The current implementation is a portfolio MVP. Authorization hardening, rate limiting, deletion failure recovery, background processing, monitoring, and production configuration require further work before serving real users.

## Roadmap

- Add versioned database migrations.
- Improve Arabic and English OCR for scanned PDFs.
- Build a larger retrieval and answer-quality evaluation benchmark.
- Add durable background processing for large documents.
- Improve retrieval with hybrid search and reranking.
- Add streaming responses and clickable document citations.
- Improve the login and onboarding experience.
- Deploy the frontend and backend with production security configuration.

## Author

**Ali Bandar**

GitHub: [@ALiBandar222](https://github.com/ALiBandar222)

Repository: [DocuLens AI](https://github.com/ALiBandar222/doculens-ai)
