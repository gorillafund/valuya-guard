# valuya/guard-laravel

Laravel middleware adapter for Valuya Guard.

## Install

```bash
composer require valuya/guard-laravel
```

## Configure

```env
VALUYA_BASE=https://pay.gorilla.build
VALUYA_TENANT_TOKEN=ttok_...
VALUYA_PLAN=standard
```

Publish config:

```bash
php artisan vendor:publish --tag=valuya-config
```

## Protect a route

```php
Route::middleware(['valuya.guard:http:route:GET:/api/premium,standard'])
  ->get('/api/premium', fn () => response()->json(['ok' => true]));
```

Behavior:
- active entitlement: route executes
- inactive entitlement:
  - web => 302 redirect to payment_url
  - api => 402 payment_required JSON
