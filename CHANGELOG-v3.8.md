# Landblaze Engine v3.8

## Evidence separation

- Sales creation now has an optional payment-evidence upload. The file is stored as a `PAYMENT_PROOF` sale document and remains separate from expense documents.
- Direct expense requests now have an optional source-document upload.
- Negotiated expense entry also accepts an optional source document at the point the expense is requested.
- Finance disbursement after CEO approval now requires a dedicated `Payment advice / bank receipt` upload and bank transfer reference.
- Finance payment advice is stored in `expense_payment_documents`, separate from `expense_documents`.
- Uploaded evidence is ownership-checked and evidence files cannot be reused across workflows.

## Database

Run `db/upgrade-v3.8.sql` on the existing Neon database.
