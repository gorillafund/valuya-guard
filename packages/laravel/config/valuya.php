<?php

return [
    'base' => env('VALUYA_BASE', ''),
    'tenant_token' => env('VALUYA_TENANT_TOKEN', env('VALUYA_SITE_TOKEN', '')),
    'default_plan' => env('VALUYA_PLAN', 'standard'),
    'default_resource' => env('VALUYA_RESOURCE', ''),
    'web_redirect' => env('VALUYA_WEB_REDIRECT', true),
    'timeout_ms' => env('VALUYA_TIMEOUT_MS', 10000),
];
