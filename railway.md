# Railway Deployment

This repository has a static GitHub Pages frontend and a Python backend.

Deploy the backend from the `backend` folder.

## Railway Settings

- Root directory: `backend`
- Start command: Railway can use the `Procfile`
- Health check path: `/health`

Environment variables:

```text
OCR_WORKERS=2
ALLOWED_ORIGINS=https://saiteja-v.github.io
```

After deployment, copy the Railway app URL into the frontend field named
**Backend API URL**.

Example:

```text
https://your-app-name.up.railway.app
```
