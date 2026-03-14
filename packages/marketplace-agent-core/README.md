# @valuya/marketplace-agent-core

Shared contracts and runtime helpers for channel-neutral marketplace agents.

This package is the default core for marketplace integrations that should work the same way across:

- WhatsApp
- Telegram
- later other channels

The merchant remains the source of:

- catalog data
- fulfillment after payment

Valuya remains the source of:

- access and subject resolution
- marketplace order creation
- checkout and payment confirmation
- paid-order delivery back to the merchant

Channel packages should use this package for:

- normalized catalog item types
- basket and order state
- checkout/status/confirm control intents
- paid confirmation rendering helpers
- backend adapter contracts
