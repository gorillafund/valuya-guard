<?php

declare(strict_types=1);

namespace Valuya\Guard\Laravel\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Valuya\Guard\Laravel\ValuyaClient;

final class ValuyaGuardMiddleware
{
    public function __construct(private readonly ValuyaClient $client)
    {
    }

    public function handle(Request $request, Closure $next, ?string $resource = null, ?string $plan = null): Response
    {
        $resolvedPlan = trim((string) ($plan ?: config('valuya.default_plan', 'standard')));
        $resolvedResource = trim((string) ($resource ?: config('valuya.default_resource', '')));
        if ($resolvedResource === '') {
            $resolvedResource = sprintf('http:route:%s:%s', strtoupper($request->method()), $request->path());
        }

        $subjectId = $this->resolveSubjectId($request);

        try {
            $ent = $this->client->entitlements($resolvedPlan, $resolvedResource, $subjectId);
            if (($ent['active'] ?? false) === true) {
                Log::info('valuya_guard_allow', ['resource' => $resolvedResource, 'plan' => $resolvedPlan, 'subject' => $subjectId]);
                return $next($request);
            }

            $required = $ent['required'] ?? ['type' => 'subscription', 'plan' => $resolvedPlan];
            $evaluatedPlan = (string) ($ent['evaluated_plan'] ?? $resolvedPlan);

            $checkout = $this->client->createCheckout([
                'resource' => $resolvedResource,
                'plan' => $evaluatedPlan,
                'evaluated_plan' => $evaluatedPlan,
                'subject' => $this->parseSubject($subjectId),
                'principal' => $this->parseSubject($subjectId),
                'required' => $required,
                'mode' => 'agent',
            ], $subjectId);

            $sessionId = (string) ($checkout['session_id'] ?? '');
            $paymentUrl = (string) ($checkout['payment_url'] ?? '');

            Log::warning('valuya_guard_deny', [
                'resource' => $resolvedResource,
                'plan' => $evaluatedPlan,
                'subject' => $subjectId,
                'session_id' => $sessionId,
            ]);

            if ($this->wantsHtml($request) && $paymentUrl !== '' && (bool) config('valuya.web_redirect', true)) {
                return new RedirectResponse($paymentUrl, 302, ['X-Valuya-Session-Id' => $sessionId]);
            }

            return new JsonResponse([
                'error' => 'payment_required',
                'reason' => $ent['reason'] ?? 'payment_required',
                'required' => $required,
                'evaluated_plan' => $evaluatedPlan,
                'resource' => $resolvedResource,
                'session_id' => $sessionId,
                'payment_url' => $paymentUrl,
            ], 402, [
                'Cache-Control' => 'no-store',
                'X-Valuya-Session-Id' => $sessionId,
                'X-Valuya-Payment-Url' => $paymentUrl,
                'Access-Control-Expose-Headers' => 'X-Valuya-Payment-Url, X-Valuya-Session-Id',
            ]);
        } catch (RuntimeException $e) {
            Log::error('valuya_guard_error', [
                'resource' => $resolvedResource,
                'plan' => $resolvedPlan,
                'subject' => $subjectId,
                'error' => $e->getMessage(),
            ]);

            return new JsonResponse([
                'ok' => false,
                'error' => 'valuya_guard_unavailable',
                'message' => 'Payment authorization is temporarily unavailable.',
            ], 503);
        }
    }

    private function resolveSubjectId(Request $request): string
    {
        $explicit = trim((string) $request->headers->get('X-Valuya-Subject-Id', ''));
        if ($explicit !== '') {
            return $explicit;
        }

        $anon = trim((string) $request->headers->get('X-Valuya-Anon-Id', 'unknown'));
        return 'anon:' . $anon;
    }

    private function wantsHtml(Request $request): bool
    {
        $accept = strtolower((string) $request->headers->get('Accept', ''));
        return str_contains($accept, 'text/html');
    }

    /** @return array{type:string,id:string} */
    private function parseSubject(string $subjectId): array
    {
        $parts = explode(':', $subjectId, 2);
        if (count($parts) === 2) {
            return ['type' => $parts[0], 'id' => $parts[1]];
        }
        return ['type' => 'anon', 'id' => 'unknown'];
    }
}
