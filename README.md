Test Live v3.1 — Free Moderation (Render-ready)
===============================================

This package uses a free external moderation endpoint (no TF.js required) to check snapshots from broadcasters.
Set the following environment variables on Render or in a .env file:
- JWT_SECRET (required)
- ADMIN_KEY (required for signup)
- MODERATION_ENDPOINT (defaults to https://nsfw-demo.onrender.com/api/moderate)

Quick local test:
1. npm install
2. node server.js
3. Open http://localhost:3000

Deploy on Render:
1. Push repo to GitHub.
2. On Render, create a Web Service or import render.yaml.
3. Set JWT_SECRET and ADMIN_KEY in Environment.
4. Deploy — builds will be fast (no TF native deps).
