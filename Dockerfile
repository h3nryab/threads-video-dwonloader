FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm ffmpeg git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
RUN python -m pip install --no-cache-dir -U yt-dlp && python -m pip install --no-cache-dir 'git+https://github.com/tribixbite/yt-dlp-threads'
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
