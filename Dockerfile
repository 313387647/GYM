FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN sed -i 's|URIs: http://deb.debian.org/debian$|URIs: http://ftp.debian.org/debian|' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update \
    && (apt-get -o Acquire::Retries=3 install -y --no-install-recommends python3 make g++ \
        || apt-get -o Acquire::Retries=3 install -y --fix-missing --no-install-recommends python3 make g++) \
    && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    GYM_DATA_DIR=/app/data \
    GYM_DB_PATH=/app/data/gym_coach.db \
    USER_TIMEZONE=Asia/Shanghai \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY prompts ./prompts
COPY scripts ./scripts
COPY plan.json config.example.json ./
COPY data/calories.json ./data/calories.json
RUN mkdir -p /app/data/inbox && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
