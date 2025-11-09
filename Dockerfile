FROM node:18-bullseye-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --progress=false
COPY . .
EXPOSE 3000
CMD ["node","server.js"]
