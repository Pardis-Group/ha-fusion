# first stage, can't use alpine for building armv7
FROM node:22 AS builder
WORKDIR /app

# copy all files
COPY . .

# install, build and prune
# use pnpm with the committed lockfile so builds are reproducible
RUN corepack enable && corepack prepare pnpm@9 --activate && \
  pnpm install --frozen-lockfile && \
  pnpm run build && \
  pnpm prune --prod

# second stage
FROM node:22-alpine
WORKDIR /app

# copy files to /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js .
COPY --from=builder /app/package.json .

# set environment
ENV PORT=5050 \
  NODE_ENV=production \
  ADDON=false

EXPOSE 5050
CMD ["node", "server.js"]
