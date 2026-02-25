<?php

declare(strict_types=1);

namespace Valuya\Guard\Laravel;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use RuntimeException;

final class ValuyaClient
{
    private Client $http;

    public function __construct(
        private readonly string $base,
        private readonly string $tenantToken,
        int $timeoutMs,
    ) {
        $this->http = new Client([
            'base_uri' => rtrim($base, '/') . '/',
            'timeout' => max(1, $timeoutMs) / 1000,
            'http_errors' => false,
        ]);
    }

    /** @return array<string,mixed> */
    public function entitlements(string $plan, string $resource, string $subjectId): array
    {
        $response = $this->request('GET', 'api/v2/entitlements', [
            'query' => ['plan' => $plan, 'resource' => $resource],
            'headers' => $this->headers($subjectId),
        ]);

        return $this->decode($response['status'], $response['body'], 'valuya_entitlements_failed');
    }

    /** @param array<string,mixed> $payload
     *  @return array<string,mixed>
     */
    public function createCheckout(array $payload, string $subjectId): array
    {
        $response = $this->request('POST', 'api/v2/checkout/sessions', [
            'headers' => $this->headers($subjectId, ['Content-Type' => 'application/json']),
            'body' => json_encode($payload, JSON_UNESCAPED_SLASHES),
        ]);

        return $this->decode($response['status'], $response['body'], 'valuya_checkout_failed');
    }

    /** @return array{status:int,body:string} */
    private function request(string $method, string $uri, array $opts): array
    {
        try {
            $response = $this->http->request($method, $uri, $opts);
            return ['status' => $response->getStatusCode(), 'body' => (string) $response->getBody()];
        } catch (GuzzleException $e) {
            throw new RuntimeException('valuya_http_transport_failed:' . $e->getMessage(), 0, $e);
        }
    }

    /** @return array<string,string> */
    private function headers(string $subjectId, array $extra = []): array
    {
        return array_merge([
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $this->tenantToken,
            'X-Valuya-Subject-Id' => $subjectId,
        ], $extra);
    }

    /** @return array<string,mixed> */
    private function decode(int $status, string $body, string $prefix): array
    {
        $json = $body !== '' ? json_decode($body, true) : [];
        if ($status >= 400) {
            throw new RuntimeException($prefix . ':' . $status . ':' . substr($body, 0, 300));
        }
        if (!is_array($json)) {
            throw new RuntimeException($prefix . ':invalid_json');
        }
        return $json;
    }
}
