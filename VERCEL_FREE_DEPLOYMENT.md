# Vercel Hobby / Serverless Deployment Notes

- Node.js is pinned to 24.x because Vercel is deprecating Node.js 20 for new Builds and Functions on October 1, 2026.
- No Fluid Compute-only duration is configured; API functions are capped at 300 seconds.
- No WebSocket server is used by the staff chat. Chat messages are persisted in PostgreSQL and refreshed through normal requests/server actions.
- Supporting-document uploads are limited to PDF/PNG/JPEG and 4 MB per file to stay conservative for serverless request bodies.
- Excel exports are lightweight HTML-based `.xls` files and PDF exports are generated without heavyweight PDF libraries.
- Exports are capped at 1,000 rows for the main lists to keep serverless response generation bounded.
- The app uses Neon HTTP queries for normal reads and short-lived transactions for writes.
- Do not add long-running workers, local filesystem persistence, in-process WebSocket servers, or large binary-processing dependencies to this deployment.
