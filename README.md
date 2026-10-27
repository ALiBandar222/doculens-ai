# DocuLens AI

**A full-stack AI document assistant with local language models, multilingual semantic search, and source citations.**

DocuLens AI lets users upload documents, ask questions in natural language, and receive answers grounded in retrieved document passages. It combines a Next.js frontend, a FastAPI backend, Supabase, and locally running AI models through Ollama.

The project demonstrates full-stack development, retrieval-augmented generation (RAG), vector search, document processing, authentication, database design, and evidence-grounded AI responses without requiring paid OpenAI API calls.

## Features

### Document management
- Upload PDF, Microsoft Word (DOCX), PowerPoint (PPTX), and TXT files.
- Extract text from English and Arabic documents.
- Use Arabic-focused OCR as a fallback for PDFs with empty or suspicious embedded text.
- Preserve PDF page numbers and PowerPoint slide numbers where supported by the parser.
- Automatically process uploads into searchable chunks and embeddings.
- Display processing status and indexed chunk counts.
- Delete documents and their associated indexed chunks.

### AI question answering
- Generate answers using Qwen 2.5 3B through Ollama.
- Search documents semantically using BGE-M3 embeddings.
- Store 1,024-dimensional vectors in PostgreSQL with pgvector.
- Display source excerpts, filenames, page numbers, and similarity scores.
- Filter weak retrieval results using a configurable similarity threshold.
- Return an insufficient-evidence response when relevant passages cannot be found.
- Run embedding generation and answer generation locally without OpenAI API calls.

### User experience
- Email/password signup and login with Supabase Auth.
- Redirect users to the dashboard after successful login or signup when a session is available.
- Unified workspace with document uploads, document selection, chat, and conversation history on one page.
- Hide/show the sidebar to give the chat more screen space.
- Save conversations, messages, and source metadata in PostgreSQL.
- Reopen previous conversations after refreshing the browser.
- Delete individual conversations and their messages.

### Testing
- Automated backend tests using pytest.
- Frontend linting using ESLint.
- Tests for text extraction, chunking, insufficient-evidence behavior, and source metadata.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Python, FastAPI |
| Database | PostgreSQL through Supabase |
| Authentication | Supabase Auth |
| File storage | Supabase Storage |
| Vector search | pgvector |
| Answer generation | Qwen 2.5 3B through Ollama |
| Embeddings | BGE-M3 through Ollama |
| PDF parsing | PyMuPDF |
| Word parsing | python-docx |
| PowerPoint parsing | python-pptx |
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
   +---- Private document storage
   |
   +---- Authenticated API requests
              |
              v
         FastAPI backend
              |
              +---- Verify user access token
              |
              +---- Validate document ownership
              |
              +---- Download private documents
              |
              +---- Extract text / OCR
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
              v
       Answer + source citations
```

## Database design

DocuLens AI uses four PostgreSQL tables. Together, they store uploaded document metadata, searchable text, vector embeddings, conversation history, and AI responses.

### 1. `documents`

Stores information about each uploaded document.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique document identifier |
| `user_id` | UUID, foreign key | Owner, referencing `auth.users(id)` |
| `filename` | TEXT | Original uploaded filename |
| `storage_path` | TEXT | Path to the private Storage object |
| `mime_type` | TEXT | Document MIME type |
| `status` | TEXT | Processing state: `processing`, `ready`, or `failed` |
| `page_count` | INTEGER, nullable | Number of PDF pages or relevant source pages when available |
| `chunk_count` | INTEGER | Number of indexed chunks |
| `error_message` | TEXT, nullable | Processing error details |
| `created_at` | TIMESTAMPTZ | Upload record creation time |

**Design decision:** The original file is stored in Supabase Storage rather than directly in PostgreSQL. The database stores its path and metadata, while the status field tracks processing progress.

### 2. `document_chunks`

Stores extracted passages and their vector embeddings.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique chunk identifier |
| `document_id` | UUID, foreign key | References `documents(id)` |
| `user_id` | UUID, foreign key | Identifies the owner |
| `chunk_index` | INTEGER | Position of the chunk within its document |
| `content` | TEXT | Extracted text |
| `page_number` | INTEGER, nullable | Source PDF page or PowerPoint slide where available |
| `embedding` | `vector(1024)` | BGE-M3 semantic embedding |
| `token_count` | INTEGER, nullable | Approximate chunk size metadata |

A unique constraint on `(document_id, chunk_index)` prevents duplicate chunk positions for a document.

**Design decision:** Chunks are stored separately from document metadata so semantic retrieval can search individual passages instead of loading entire documents. The 1,024-dimensional vector format matches the local BGE-M3 model.

### 3. `conversations`

Stores each user's chat sessions.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique conversation identifier |
| `user_id` | UUID, foreign key | Conversation owner |
| `title` | TEXT | Conversation title |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last activity timestamp |

Conversation titles are initialized from the user's first question when a conversation is created through the chat API.

### 4. `messages`

Stores individual user questions and assistant responses.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID, primary key | Unique message identifier |
| `conversation_id` | UUID, foreign key | References `conversations(id)` |
| `user_id` | UUID, foreign key | Identifies the owner |
| `role` | TEXT | `user` or `assistant` |
| `content` | TEXT | Message content |
| `citations` | JSONB | Source identifiers, excerpts, page numbers, and similarity metadata |
| `created_at` | TIMESTAMPTZ | Message creation time |

**Design decision:** Citations are stored with assistant messages so the sources can be restored when a conversation is reopened.

### Relationships

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

- Each document belongs to one user.
- Each document can contain many chunks.
- Each conversation belongs to one user.
- Each conversation can contain many messages.
- Foreign keys and cascading relationships are configured for associated records.
- Row Level Security policies restrict access to user-owned records.

### How the database was created

The initial schema was created manually in the Supabase SQL Editor during development.

The setup included:

1. Enabling the PostgreSQL `vector` extension in the `extensions` schema.
2. Creating the four tables and their primary keys, foreign keys, constraints, and default values.
3. Enabling Row Level Security on all four tables.
4. Creating policies for user-owned documents, chunks, conversations, and messages.
5. Granting the required database privileges to the authenticated and backend roles.
6. Changing the embedding column to `extensions.vector(1024)` after switching from OpenAI embeddings to local BGE-M3.
7. Creating the `match_document_chunks` PostgreSQL function for semantic retrieval.
8. Creating a private Storage bucket named `documents` and a policy restricting file access to the owning user's folder.

The semantic search function compares a question embedding against stored document embeddings using cosine distance. It supports optional document filtering and returns relevant chunks with similarity scores.

**Reproducibility note:** The current schema was configured manually and is not yet managed by a versioned migration system. Adding a reusable SQL schema/migration file is a planned improvement.

## Document processing and RAG pipeline

1. **Upload:** The user selects a supported file in the unified workspace.
2. **Store:** The original file is uploaded to the private Supabase Storage bucket.
3. **Register:** A document record is created in PostgreSQL.
4. **Extract:** FastAPI downloads the stored file and extracts text using the relevant parser.
5. **OCR:** Arabic-focused Tesseract OCR is used when PDF text appears empty or unreliable.
6. **Chunk:** Extracted text is divided into overlapping chunks with source-location metadata.
7. **Embed:** BGE-M3 generates a 1,024-dimensional embedding for each chunk.
8. **Index:** Text chunks and embeddings are saved to PostgreSQL.
9. **Retrieve:** The user's question is embedded locally, and pgvector finds similar passages.
10. **Generate:** Qwen receives the retrieved context and generates an answer.
11. **Cite:** The response includes source excerpts and their document locations.
12. **Persist:** The question, answer, and citation metadata are saved to the conversation history.

## Security

- Supabase authentication provides user signup, email confirmation, and login.
- The Storage bucket is private.
- The backend verifies Supabase access tokens and checks document ownership.
- Row Level Security protects database access through authenticated client roles.
- The privileged Supabase backend key is used only in the backend.
- Uploaded document contents must be treated as untrusted input.

**Important:** The current implementation is a portfolio MVP. Authorization, deletion failure recovery, rate limiting, document-processing reliability, and production configuration require additional hardening before deployment to real users.

## Getting started

### Prerequisites

- Python 3.10 or newer.
- Node.js and npm.
- Git.
- [Ollama](https://ollama.com/download).
- A [Supabase](https://supabase.com/) project.
- [Tesseract OCR for Windows](https://github.com/UB-Mannheim/tesseract/wiki), with Arabic (`ara`) language data for Arabic OCR.

Local model performance depends on available RAM, CPU, GPU, and model configuration.

### 1. Clone the repository

```powershell
git clone https://github.com/ALiBandar222/doculens-ai.git
cd doculens-ai
```

### 2. Download the local AI models

```powershell
ollama pull qwen2.5:3b
ollama pull bge-m3
ollama list
```

Both models must be available in Ollama before using document processing or chat.

### 3. Configure Supabase

Create a Supabase project and configure the database schema, vector function, RLS policies, privileges, and private Storage bucket described above.

The SQL configuration was created manually during development. The application does not yet provide an automated schema migration command.

### 4. Configure the backend

Create `backend/.env`:

```dotenv
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-secret-key
```

Replace the example values with your actual Supabase credentials. Never commit this file or expose the backend secret to the browser.

### 5. Install backend dependencies

From the project root:

```powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

For Arabic OCR, ensure Tesseract is installed with Arabic language data. The current parser expects this Windows installation path:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Start the backend:

```powershell
cd backend
python -m uvicorn main:app --reload
```

FastAPI runs at `http://127.0.0.1:8000`. Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### 6. Configure the frontend

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
2. Upload a PDF, DOCX, PPTX, or TXT file from the dashboard.
3. Wait until processing finishes and the status becomes `ready`.
4. Select one or more documents in the workspace.
5. Ask a question and inspect the generated answer and citations.
6. Reopen conversations from the history sidebar or delete conversations you no longer need.

## Testing

### Backend

From the backend directory with the virtual environment activated:

```powershell
python -m pytest -q
```

The current suite contains four tests covering text extraction, chunking and page-number preservation, insufficient-evidence behavior, and answer/source metadata. It does not yet represent a comprehensive end-to-end evaluation of answer accuracy.

### Frontend

From the frontend directory:

```powershell
npm run lint
```

## Known limitations and roadmap

- Arabic OCR can still misrecognize characters, diacritics, and complex layouts.
- Scanned English PDFs need additional OCR configuration.
- DOCX pagination is not preserved by the current parser.
- Retrieval thresholds need evaluation on a larger benchmark.
- Document processing currently runs synchronously.
- Database schema creation is manual rather than migration-based.
- Automated tests should be expanded to cover authentication, ownership, deletion, and end-to-end workflows.
- Production deployment, monitoring, rate limiting, and durable background jobs remain future work.

Planned enhancements include versioned database migrations, hybrid retrieval and reranking, streaming responses, clickable document citations, improved OCR, and production deployment.

## Author

**Ali Bandar**

GitHub: [@ALiBandar222](https://github.com/ALiBandar222)

Repository: [DocuLens AI](https://github.com/ALiBandar222/doculens-ai)
