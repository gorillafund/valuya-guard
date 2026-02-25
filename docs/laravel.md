# Laravel Adapter

Package: `valuya/guard-laravel`

Use middleware alias `valuya.guard` to protect routes.

```php
Route::middleware(['valuya.guard:http:route:GET:/api/premium,standard'])
  ->get('/api/premium', fn () => response()->json(['ok' => true]));
```

Defaults:
- HTML clients => redirect to `payment_url`
- API clients => canonical `402 payment_required`
