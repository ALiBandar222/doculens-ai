
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from answer_generator import answer_question
from document_processor import process_document
from supabase_client import supabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="DocuLens AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    document_ids: list[UUID] | None = None
    conversation_id: UUID | None = None


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", max_length=200)


def get_authenticated_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    try:
        result = supabase.auth.get_user(credentials.credentials)

        if result.user is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication token.",
            )

        return result.user

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
        ) from exc


def get_owned_conversation(conversation_id: str, user_id: str) -> dict:
    result = (
        supabase.table("conversations")
        .select("id, title, created_at, updated_at")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    return result.data[0]


@app.get("/")
def read_root():
    return {"message": "DocuLens AI backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/v1/documents/{document_id}/process")
def process_uploaded_document(
    document_id: UUID,
    user=Depends(get_authenticated_user),
):
    try:
        return process_document(
            document_id=str(document_id),
            user_id=str(user.id),
        )

    except ValueError as exc:
        if str(exc) == "Document not found or not owned by this user.":
            raise HTTPException(
                status_code=404,
                detail="Document not found.",
            ) from exc

        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("Document processing failed")
        raise HTTPException(
            status_code=500,
            detail="Document processing failed. Check backend logs.",
        ) from exc


@app.get("/api/v1/documents/{document_id}/signed-url")
def get_document_signed_url(
    document_id: UUID,
    user=Depends(get_authenticated_user),
):
    user_id = str(user.id)

    # Only allow access to documents owned by this user.
    result = (
        supabase.table("documents")
        .select("id, filename, storage_path, mime_type")
        .eq("id", str(document_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=404,
            detail="Document not found.",
        )

    document = result.data[0]

    try:
        # Generate a temporary link to the private Storage object.
        signed_result = (
            supabase.storage
            .from_("documents")
            .create_signed_url(document["storage_path"], 300)
        )

        if hasattr(signed_result, "model_dump"):
            signed_result = signed_result.model_dump()

        if isinstance(signed_result, dict):
            signed_url = (
                signed_result.get("signedURL")
                or signed_result.get("signedUrl")
                or signed_result.get("signed_url")
            )
        else:
            signed_url = (
                getattr(signed_result, "signedURL", None)
                or getattr(signed_result, "signedUrl", None)
            )

        if not signed_url:
            raise ValueError("Supabase did not return a signed URL.")

        return {
            "signed_url": signed_url,
            "filename": document["filename"],
            "mime_type": document["mime_type"],
            "expires_in": 300,
        }

    except Exception as exc:
        logger.exception("Could not create document preview URL")
        raise HTTPException(
            status_code=500,
            detail="Could not generate a document preview link.",
        ) from exc
  
@app.delete("/api/v1/documents/{document_id}")
def delete_document(
    document_id: UUID,
    user=Depends(get_authenticated_user),
):
    user_id = str(user.id)

    # Find the document and verify ownership.
    result = (
        supabase.table("documents")
        .select("id, storage_path")
        .eq("id", str(document_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=404,
            detail="Document not found.",
        )

    document = result.data[0]

    # Delete the original file from private storage.
    try:
        supabase.storage.from_("documents").remove(
            [document["storage_path"]]
        )
    except Exception as exc:
        logger.exception("Could not delete document file")
        raise HTTPException(
            status_code=500,
            detail="Could not delete the stored file.",
        ) from exc

    # Delete the database record and its associated chunks.
    try:
        (
            supabase.table("documents")
            .delete()
            .eq("id", str(document_id))
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        logger.exception("Could not delete document record")
        raise HTTPException(
            status_code=500,
            detail="The file was removed, but the database record could not be deleted.",
        ) from exc

    return {
        "deleted": True,
        "document_id": str(document_id),
    }



@app.get("/api/v1/conversations")
def list_conversations(user=Depends(get_authenticated_user)):
    result = (
        supabase.table("conversations")
        .select("id, title, created_at, updated_at")
        .eq("user_id", str(user.id))
        .order("updated_at", desc=True)
        .execute()
    )

    return {"conversations": result.data or []}


@app.post("/api/v1/conversations")
def create_conversation(
    request: ConversationCreate,
    user=Depends(get_authenticated_user),
):
    title = request.title.strip() or "New conversation"

    result = (
        supabase.table("conversations")
        .insert({
            "user_id": str(user.id),
            "title": title,
        })
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=500,
            detail="Could not create conversation.",
        )

    return result.data[0]


@app.get("/api/v1/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: UUID,
    user=Depends(get_authenticated_user),
):
    user_id = str(user.id)

    get_owned_conversation(str(conversation_id), user_id)

    result = (
        supabase.table("messages")
        .select("id, conversation_id, role, content, citations, created_at")
        .eq("conversation_id", str(conversation_id))
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )

    return {"messages": result.data or []}

    
@app.delete("/api/v1/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: UUID,
    user=Depends(get_authenticated_user),
):
    user_id = str(user.id)
    conversation_id_str = str(conversation_id)

    # Verify ownership before deleting anything.
    get_owned_conversation(conversation_id_str, user_id)

    try:
        # Delete the messages in this conversation.
        (
            supabase.table("messages")
            .delete()
            .eq("conversation_id", conversation_id_str)
            .eq("user_id", user_id)
            .execute()
        )

        # Delete the conversation itself.
        (
            supabase.table("conversations")
            .delete()
            .eq("id", conversation_id_str)
            .eq("user_id", user_id)
            .execute()
        )

        return {
            "deleted": True,
            "conversation_id": conversation_id_str,
        }

    except Exception as exc:
        logger.exception("Conversation deletion failed")
        raise HTTPException(
            status_code=500,
            detail="Could not delete the conversation.",
        ) from exc

@app.post("/api/v1/chat")
def chat_with_documents(
    request: ChatRequest,
    user=Depends(get_authenticated_user),
):
    user_id = str(user.id)
    question = request.question.strip()

    if not question:
        raise HTTPException(
            status_code=422,
            detail="Question cannot be empty.",
        )

    # Validate that selected documents belong to this user
    # and have completed processing.
    if request.document_ids is not None:
        requested_ids = [str(item) for item in request.document_ids]

        if not requested_ids:
            raise HTTPException(
                status_code=422,
                detail="Select a document or omit document_ids to search all documents.",
            )

        docs_result = (
            supabase.table("documents")
            .select("id")
            .eq("user_id", user_id)
            .eq("status", "ready")
            .in_("id", requested_ids)
            .execute()
        )

        owned_ids = {row["id"] for row in (docs_result.data or [])}

        if owned_ids != set(requested_ids):
            raise HTTPException(
                status_code=404,
                detail="One or more selected documents are unavailable.",
            )

    # Use an existing conversation or create one automatically.
    if request.conversation_id is not None:
        conversation = get_owned_conversation(
            str(request.conversation_id),
            user_id,
        )
        conversation_id = conversation["id"]
    else:
        created = (
            supabase.table("conversations")
            .insert({
                "user_id": user_id,
                "title": question[:70],
            })
            .execute()
        )

        if not created.data:
            raise HTTPException(
                status_code=500,
                detail="Could not create conversation.",
            )

        conversation = created.data[0]
        conversation_id = conversation["id"]

    # Save the user's question.
    supabase.table("messages").insert({
        "conversation_id": conversation_id,
        "user_id": user_id,
        "role": "user",
        "content": question,
        "citations": [],
    }).execute()

    try:
        result = answer_question(
            question=question,
            user_id=user_id,
            document_ids=(
                [str(item) for item in request.document_ids]
                if request.document_ids is not None
                else None
            ),
        )

        answer = result["answer"]
        sources = result.get("sources", [])

        # Save the AI answer and its source metadata.
        supabase.table("messages").insert({
            "conversation_id": conversation_id,
            "user_id": user_id,
            "role": "assistant",
            "content": answer,
            "citations": sources,
        }).execute()

        # Update conversation activity.
        supabase.table("conversations").update({
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq(
            "id", conversation_id
        ).eq(
            "user_id", user_id
        ).execute()

        return {
            "conversation_id": conversation_id,
            "answer": answer,
            "sources": sources,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Document question answering failed")
        raise HTTPException(
            status_code=500,
            detail="Unable to answer the question. Check backend logs.",
        ) from exc
