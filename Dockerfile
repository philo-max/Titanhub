FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/plugin-types/package.json ./packages/plugin-types/
COPY packages/theme/package.json ./packages/theme/
COPY packages/plugin-adapter/package.json ./packages/plugin-adapter/
COPY server/package.json ./server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/ ./packages/
COPY server/ ./server/
COPY tsconfig.json .eslintrc.json .prettierrc ./

# Build packages
RUN pnpm --filter @titanhub/plugin-types build
RUN pnpm --filter @titanhub/theme build
RUN pnpm --filter @titanhub/plugin-adapter build

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "titanhub-server", "start"]
