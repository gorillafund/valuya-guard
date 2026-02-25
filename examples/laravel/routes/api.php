<?php

use Illuminate\Support\Facades\Route;

Route::middleware(['valuya.guard:http:route:GET:/api/premium,standard'])
    ->get('/premium', fn () => response()->json(['ok' => true]));
