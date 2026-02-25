<?php

declare(strict_types=1);

namespace Valuya\Guard\Laravel;

use Illuminate\Contracts\Container\Container;
use Illuminate\Support\ServiceProvider;
use Valuya\Guard\Laravel\Middleware\ValuyaGuardMiddleware;

final class ValuyaGuardServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/valuya.php', 'valuya');

        $this->app->singleton(ValuyaClient::class, function (Container $app): ValuyaClient {
            return new ValuyaClient(
                (string) config('valuya.base', ''),
                (string) config('valuya.tenant_token', ''),
                (int) config('valuya.timeout_ms', 10000),
            );
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../config/valuya.php' => config_path('valuya.php'),
        ], 'valuya-config');

        $router = $this->app['router'];
        $router->aliasMiddleware('valuya.guard', ValuyaGuardMiddleware::class);
    }
}
