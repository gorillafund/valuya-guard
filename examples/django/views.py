from django.http import JsonResponse


def premium(request):
    return JsonResponse({"ok": True})
