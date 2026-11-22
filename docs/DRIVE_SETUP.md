# Google Drive archive integration

The deployed calendar includes admin-only setup, OAuth authorization, and yearly Excel export to a private Drive folder. Image upload support remains in server/drive.mjs but image UI/routes are not yet enabled.

## One-time Google setup
1. Use apexa2251@gmail.com in Google Cloud and enable Google Drive API.
2. Configure External OAuth consent for the calendar. Scope: https://www.googleapis.com/auth/drive.file only.
3. Create a Web application OAuth client. Authorized redirect URI: https://apexcare-calendar.onrender.com/api/drive/callback
4. In the executive account open أرشفة Excel وDrive then إعداد ربط Google. Enter Client ID and Secret there, never in chat or source code.
5. Complete Google consent with the intended archive account. A private folder named تقويم أبكس كير is created.

## Security and operation
- Client settings and refresh tokens use AES-256-GCM. CALENDAR_CREDENTIAL_KEY lives only in Render environment variables; do not rotate without reconnecting.
- OAuth state is single use, ten minutes, bound to the administrator and session. Callback uses an encrypted HttpOnly Secure SameSite=Lax cookie.
- The server validates the executive session for parse, export, settings, and authorization routes. Data tables remain private with RLS.
- Excel bytes are transferred directly to Drive or the user; no archive/image bytes are stored in Supabase. Metadata and encrypted credentials are distinct from file content.
- No public Drive permissions are created.
- External apps left in Testing can need reauthorization. Verify publishing status and refresh-token lifetime for long-term use.

## Verification remaining
Real Google authorization and upload must be verified after the owner completes the client setup. Local tests cover encryption, session-bound OAuth, file restrictions, Excel import/export, and history retention.
