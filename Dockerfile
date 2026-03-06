FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production=false

COPY . .
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

CMD ["node", "dist/worker.js"]
