# Cloudflare Pages — Build Configuration
# Settings di Cloudflare Dashboard:
#   Framework preset : Vite
#   Build command    : npm run build
#   Build output dir : dist
#   Root directory   : smarttrading/frontend-react

# Environment Variables (set di Cloudflare Dashboard > Settings > Env Vars):
#   VITE_SUPABASE_URL    = https://xxxx.supabase.co
#   VITE_SUPABASE_ANON   = eyJhbGci...  (anon/public key — READ ONLY)
#
# PENTING: Jangan pernah taruh SUPABASE_SERVICE_KEY di frontend!
# Service key hanya untuk GitHub Actions (backend).
