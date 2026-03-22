FROM node:20-slim
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm ci --omit=dev 2>/dev/null || npm install --production

# Copy app files
COPY server.js ./
COPY hs-lookup.js ./
COPY names-pool.json ./
COPY learned-hs.json* ./

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
