"""Run directly on Windows with the project's ignored .env.local configuration."""
import os
from pathlib import Path
import uvicorn

if __name__ == "__main__":
    for line in (Path(__file__).resolve().parent.parent / ".env.local").read_text(encoding="utf8").splitlines():
        if line.startswith(("BIOMETRIC_", "NEXT_PUBLIC_SUPABASE_URL=", "SUPABASE_SERVICE_ROLE_KEY=")) and "=" in line:
            name, value = line.split("=", 1)
            os.environ.setdefault(name, value.strip().strip('"').strip("'"))
    uvicorn.run("app:app", host="127.0.0.1", port=8765, access_log=False)
