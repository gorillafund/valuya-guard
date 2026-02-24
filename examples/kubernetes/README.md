Copy manifests from `@valuya/kubernetes/templates` and apply:

```bash
kubectl apply -f valuya-authz-deployment.yaml
kubectl apply -f valuya-authz-service.yaml
kubectl apply -f ingress-nginx-auth-request.yaml
```
