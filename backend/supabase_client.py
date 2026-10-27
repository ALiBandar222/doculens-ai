
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# Always load the .env file located beside this Python file.
ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is missing from backend/.env")

if not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_SERVICE_ROLE_KEY is missing from backend/.env"
    )

# Backend-only client. Never expose this client or its key to the frontend.
supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
