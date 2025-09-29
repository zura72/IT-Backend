FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 4000   # hanya expose default, tapi app bakal ikut env Railway
CMD ["node", "server.js"]
