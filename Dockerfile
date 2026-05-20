FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ranking/package.json packages/ranking/package.json
COPY packages/rss/package.json packages/rss/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY . .

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS topic-runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 python3-dev python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/topic-snapshot/requirements.txt scripts/topic-snapshot/requirements.txt

RUN python3 -m venv /opt/dibao-topic-snapshot \
  && /opt/dibao-topic-snapshot/bin/python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/dibao-topic-snapshot/bin/python -m pip install --no-cache-dir -r scripts/topic-snapshot/requirements.txt

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
  DIBAO_HOST=0.0.0.0 \
  DIBAO_PORT=8080 \
  DIBAO_DATABASE_PATH=/data/dibao.sqlite \
  DIBAO_COOKIE_SECURE=false \
  DIBAO_TOPIC_SNAPSHOT_COMMAND="/opt/dibao-topic-snapshot/bin/python /app/scripts/topic-snapshot/bertopic_snapshot.py" \
  DIBAO_TOPIC_SNAPSHOT_TOKENIZER=mixed

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libgomp1 python3 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data \
  && chown -R node:node /data /app

COPY --from=topic-runner --chown=node:node /opt/dibao-topic-snapshot /opt/dibao-topic-snapshot
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --chown=node:node scripts/topic-snapshot ./scripts/topic-snapshot

USER node

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const port=process.env.DIBAO_PORT||'8080'; fetch(`http://127.0.0.1:${port}/api/system/health`).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1));"]

CMD ["node", "apps/server/dist/index.js"]
