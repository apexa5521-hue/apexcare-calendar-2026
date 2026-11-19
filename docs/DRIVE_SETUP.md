# Gmail attachment integration

Implemented server module: `server/drive.mjs`. It is not deployed or wired to the legacy Apps Script backend. Do not expose upload routes before authenticated account and note authorization are implemented.

## Required setup
1. Create/select a dedicated Google Cloud project and enable Google Drive API.
2. Configure an External OAuth consent screen for the Gmail owner, requesting only `drive.file`.
3. Create a Web application OAuth client with the exact deployed callback URL.
4. Store client ID, secret and a random 32-byte base64 encryption key in server secrets, never browser assets.
5. Supply a durable private storage adapter for OAuth state (atomic single-use consumption), encrypted connection credentials, attachment metadata, and account/note permissions.
6. Complete consent while signed in to the intended Gmail owner. The application creates its own dedicated folder; uploaded images remain private.
7. Before release, check Google consent publishing status and refresh-token lifetime. External apps left in Testing can require reauthorization; do not promise permanent access.

## Storage contract
Only attachment ID, note ID, uploader ID, Drive file ID, name, MIME type and byte count belong in the application attachment table. Image bytes are transient during transfer only and never written to Supabase Storage, database columns, logs or local disk. OAuth credentials are encrypted secrets, distinct from attachment records.

## Remaining integration
- Select an independent Supabase project; do not use Masar-Production.
- Secure individual accounts and authorization for every data route; the legacy PIN and public Apps Script access are not a production authorization system.
- Add admin-only Drive connection routes, session-bound callback, upload UI and streamed private image endpoint.
- Add CSRF protection, request body limits and distributed rate limits at route level.
- Verify real Gmail authorization, upload, read, permission denial, reconnect, and database metadata before deployment.

Run `node --test server/drive.test.mjs` for the available isolation tests.
