#!/usr/bin/env bash
# Fails if server-only secrets leak into the client bundle.
set -euo pipefail
if [ ! -d dist ]; then echo "dist/ not found — run npm run build first"; exit 1; fi

PATTERNS='sk-ant-|SUPABASE_SERVICE_ROLE_KEY|service_role'
if grep -rEl "$PATTERNS" dist/ 2>/dev/null; then
  echo "❌ Secret-looking strings found in client bundle (patterns: $PATTERNS)"
  exit 1
fi

# The literal value of the service key, if the environment knows it (CI/local with .env).
# Catches the realistic leak: a VITE_-prefixed alias inlining the raw JWT into the bundle.
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  if grep -rFl "$SUPABASE_SERVICE_ROLE_KEY" dist/ 2>/dev/null; then
    echo "❌ The SUPABASE_SERVICE_ROLE_KEY value itself is in the client bundle"
    exit 1
  fi
fi

# Decode every JWT-looking token in the bundle and flag service_role payloads.
# (The anon key is a JWT too and is allowed — only the role claim matters.)
leaked=0
while IFS= read -r token; do
  payload=$(printf '%s' "$token" | cut -d. -f2 | tr '_-' '/+')
  case $(( ${#payload} % 4 )) in 2) payload="${payload}==";; 3) payload="${payload}=";; esac
  if printf '%s' "$payload" | base64 -d 2>/dev/null | grep -q '"role"[[:space:]]*:[[:space:]]*"service_role"'; then
    echo "❌ A JWT with role=service_role is in the client bundle: ${token:0:24}…"
    leaked=1
  fi
done < <(grep -rhoE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' dist/ 2>/dev/null | sort -u)
if [ "$leaked" -eq 1 ]; then exit 1; fi

echo "✅ No server secrets in client bundle"
