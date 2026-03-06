FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production=false

COPY . .
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

CMD ["node", "dist/worker.js"]
