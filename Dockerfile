FROM node:8-wheezy

RUN apt-get update

RUN apt-get install -y mp4v2-utils

WORKDIR /app/

COPY *.js ./
COPY *.sh ./
COPY package.json ./

RUN npm install

ENTRYPOINT ["./run.sh"]