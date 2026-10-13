FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @quorum-lab/control-api build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV CONTROL_API_PORT=8080
ENV CONTROL_API_HOST=0.0.0.0
COPY --from=builder /app ./
EXPOSE 8080
CMD ["node", "apps/control-api/dist/main.js"]
