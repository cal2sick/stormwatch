# Stormwatch: one container serves the API, WebSocket and the built HUD on :8787.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build
# Inside the container the server must listen on all interfaces; docker-compose publishes it to 127.0.0.1 only.
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
