# Dockerfile for Render deployment with Puppeteer & Malayalam font support

FROM node:20-slim

# Install Chromium and system dependencies for Puppeteer & Malayalam fonts
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-smc \
    fonts-indic \
    fonts-noto-core \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    ca-certificates \
    libgconf-2-4 \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk1.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer executable path to installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PORT=3000

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Start breaking news service
CMD ["node", "index.js"]
