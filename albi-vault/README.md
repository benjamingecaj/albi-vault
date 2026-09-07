# ALBI VAULT

Private credential portal for ALBI Group.

## Live Supabase backend
- Project: Albi VAULT
- Region: Zurich (eu-central-2)
- Project ref: wkawcvkfjcyhcepbvggf
- Edge Function: vault-api

## Security model
- Only @albigroup.com accounts may register.
- The first @albigroup.com account created becomes the administrator.
- Later users default to viewer unless created as admin by an administrator.
- Credential secrets are encrypted in Postgres using pgcrypto / AES-256-compatible symmetric encryption.
- The encryption master key is stored in a locked database settings table inaccessible to anon/authenticated roles.
- Browser uses only the Supabase publishable key.
- Privileged operations run inside the Supabase Edge Function with the server secret key supplied by Supabase's function environment.
- Every password reveal is written to vault_audit_logs.
- Public/normal authenticated database roles have no direct privileges on the vault tables.

## Frontend environment
Create `.env.local`:

NEXT_PUBLIC_SUPABASE_URL=https://wkawcvkfjcyhcepbvggf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>

The included `.env.local` is already configured for the current project. The publishable key is safe to expose in frontend code; never add a Supabase secret/service-role key to the browser.

## Deploy on Vercel
1. Push this folder to a private Git repository.
2. Import the repository into Vercel as a Next.js project.
3. Add the two NEXT_PUBLIC_* environment variables above.
4. Deploy.
5. Add `vault.albigroup.com` under Project > Settings > Domains.
6. Add the DNS record Vercel requests at your DNS provider.

## First administrator
1. Open the deployed site.
2. Choose "First time? Create an account".
3. Register with your @albigroup.com email address.
4. The first successfully created ALBI account automatically becomes `admin`.
5. After that, use Users inside ALBI VAULT to create viewer accounts for staff.

## Import from Excel
Copy rows from Excel and paste them into Import Excel.
The expected first row is:

brand	platform	login_url	username	password	recovery_email	has_2fa	notes

Passwords are encrypted server-side during import.

## Important
This app intentionally prevents direct table access from the browser. RLS is enabled with no browser-facing policies, and table grants are revoked. The Supabase Security Advisor may report "RLS enabled no policy" as informational; for this design that is intentional because access is only through the authenticated backend function.
