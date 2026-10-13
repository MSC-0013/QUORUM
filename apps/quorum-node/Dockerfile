FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @quorum-lab/quorum-node... build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=builder /app ./
EXPOSE 8080
EXPOSE 50051
CMD ["node", "apps/quorum-node/dist/main.js"]
