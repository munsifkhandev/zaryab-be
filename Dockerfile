FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global npm@11.20.0 --ignore-scripts
COPY package*.json ./
COPY .npmrc ./
RUN npm ci
COPY nest-cli.json tsconfig*.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Generation needs a URL but does not connect to this build-only placeholder.
RUN DATABASE_URL=postgresql://build.invalid/build npm run build

FROM build AS migrate
CMD ["npm", "run", "db:migrate:deploy"]

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install --global npm@11.20.0 --ignore-scripts
COPY package*.json ./
COPY .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
