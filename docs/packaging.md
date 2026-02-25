# Packaging & Distribution

## npm packages

Install examples:

```bash
npm i @valuya/core @valuya/agent @valuya/node-express
npm i @valuya/nextjs @valuya/cloudflare-workers @valuya/reverse-proxy
```

Stability: semantic versioning per package.

## Python packages

```bash
pip install valuya-guard valuya-fastapi valuya-django
```

## Composer (PHP)

```bash
composer require valuya/guard-laravel
```

## RubyGems

```bash
gem install valuya-guard-rails
```

## Maven

```xml
<dependency>
  <groupId>build.valuya</groupId>
  <artifactId>valuya-guard-spring-boot-starter</artifactId>
  <version>0.2.0-beta.1</version>
</dependency>
```

## Go modules

```bash
go get github.com/valuya/go-guard
```

## Docker image

Gateway source and Dockerfile:

- `docker/gateway/Dockerfile`

Build locally:

```bash
docker build -t valuya-guard-gateway:local docker/gateway
```
