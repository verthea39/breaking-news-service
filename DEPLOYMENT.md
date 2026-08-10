# Cloud Hosting Deployment Guide for Breaking News Service

This guide explains how to deploy your **Breaking News Service** to cloud hosting for permanent, global internet access.

---

## Option 1: Render.com (Recommended for Free/Easy Cloud Hosting)

Render provides free HTTPS web hosting and supports Docker containers (which includes Chromium and Malayalam font rendering).

### Steps to Deploy on Render:
1. **Push your code to GitHub**:
   - Create a GitHub repository and push `breaking-news-service` to it.
2. **Sign up on Render**:
   - Go to [render.com](https://render.com) and log in with GitHub.
3. **Create New Web Service**:
   - Click **New +** -> **Web Service**.
   - Connect your GitHub repository.
4. **Configure Service**:
   - **Name**: `breaking-news-service`
   - **Runtime**: `Docker` (Render automatically uses the included `Dockerfile`)
   - **Instance Type**: Free (or Starter if persistent disk is needed)
   - **Environment Variables**:
     - `PORT` = `3000`
     - `HOST` = `0.0.0.0`
5. **Deploy**:
   - Click **Create Web Service**.
   - Render will build the Docker container with Chromium & Malayalam fonts.
   - Once deployed, you will get a permanent public URL:
     `https://breaking-news-service.onrender.com/admin.html`

---

## Option 2: Railway.app (Easy Deployment + Persistent Data)

Railway allows containerized apps with persistent volume storage for SQLite database & WhatsApp session files.

### Steps to Deploy on Railway:
1. Go to [railway.app](https://railway.app) and sign up with GitHub.
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select your repository. Railway will detect the `Dockerfile` automatically.
4. Add a **Volume** mounted at `/app/data` to persist your WhatsApp login session and database (`news.db`).
5. Generate a **Public Domain** under service settings.
6. Open your global URL: `https://your-app.up.railway.app/admin.html`.

---

## Option 3: VPS Deployment (DigitalOcean / EC2 / Hetzner)

If hosting on an Ubuntu VPS:

1. Clone repository to server:
   ```bash
   git clone <your-repo-url>
   cd breaking-news-service
   ```
2. Build and start using Docker:
   ```bash
   docker build -t breaking-news .
   docker run -d -p 3000:3000 --name news-service -v news_data:/app/data breaking-news
   ```
3. Access via `http://<your-vps-ip>:3000/admin.html` or set up Nginx + SSL domain.

---

## Quick Alternative: Instant Tunnel (Running locally, exposed globally)

If you prefer keeping the app running on your local machine but want a public web link accessible anywhere:

Double-click `start-tunnel.bat` or run:
```bash
npm run tunnel
```
This generates a temporary public HTTPS link (e.g. `https://xxxx.loca.lt/admin.html`) accessible on mobile or external networks without cloud hosting setup.
