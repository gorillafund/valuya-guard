# Go net/http Example

```bash
export VALUYA_BASE=https://pay.gorilla.build
export VALUYA_TENANT_TOKEN=ttok_...
go run main.go
```

Call `GET /premium` with subject header:

```bash
curl -i http://localhost:8080/premium -H 'X-Valuya-Subject-Id: user:1' -H 'Accept: application/json'
```
