# Single image: Node serves the built client and the WebSocket world on one port.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# Demo worlds go beside the world file, under /data/demos/. A read-only public showcase sets SPECTATE=1 and
# DEFAULT_DEMO=<id> (e.g. london) when it runs the image (docs/demo.md, "A public showcase").
ENV NODE_ENV=production PORT=8080 WORLD_FILE=/data/world.json
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/client/dist ./packages/client/dist
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
