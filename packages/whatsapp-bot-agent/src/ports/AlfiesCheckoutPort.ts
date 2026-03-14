export type AlfiesCartLine = {
  productId?: number
  sku: string
  name: string
  qty: number
  unitPriceCents?: number
}

export type AlfiesDeliveryAddress = {
  line1: string
  house: string
  postcode: string
  city: string
  latitude: number
  longitude: number
  phone?: string
  notes?: string
}

export type AlfiesResolvedAddress = AlfiesDeliveryAddress & {
  id?: number
  shippingMethod?: string
  warehouseCode?: string
}

export type AlfiesShippingOption = {
  date?: string
  code: string
  name?: string
  shippingChargeCents?: number
  currency?: string
  raw?: Record<string, unknown>
}

export type AlfiesCheckoutPort = {
  priceCart(args: {
    lines: AlfiesCartLine[]
  }): Promise<{ amountCents: number; currency: string }>
  prepareCheckout(args: {
    localOrderId: string
    protocolSubjectHeader: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    shippingDate: string
    deliveryNote?: string
    phone?: string
  }): Promise<{
    ok: true
    basketTotalCents: number
    currency: string
    shippingAddressId?: number
    shippingAddress: AlfiesResolvedAddress
    shippingOptions: AlfiesShippingOption[]
    suggestedShippingOption?: AlfiesShippingOption
    preview?: Record<string, unknown>
  }>
  submitPaidOrder(args: {
    localOrderId: string
    protocolSubjectHeader: string
    paymentReference: string
    lines: AlfiesCartLine[]
    deliveryAddress: AlfiesDeliveryAddress
    billingAddress?: AlfiesDeliveryAddress
    shippingOption: AlfiesShippingOption
    expectedTotalCents: number
  }): Promise<{
    ok: true
    externalOrderId: string
    externalOrderStatus?: string
    submittedAt: string
  }>
  dispatchOrder(args: {
    localOrderId: string
    lines: AlfiesCartLine[]
    protocolSubjectHeader: string
  }): Promise<{ ok: true; externalOrderId?: string }>
}
