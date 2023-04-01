/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable  @typescript-eslint/no-explicit-any */
import { json } from 'co-body'
import SimpleCrypto from 'simple-crypto-js'

import { settings } from '../../constants'
import type { AddressForm } from '../../typings'
import { getSkuWithVariations } from '../catalog'
import { mapItems } from '../utils/common'
import { formatError } from '../utils/error'

export async function generateInvoice(ctx: any, next: () => Promise<any>) {
  const {
    clients: { smartbill },
  } = ctx

  const body = await json(ctx.req)

  ctx.status = 200
  ctx.body = smartbill.getEncryptedNumber(body)

  await next()
}

export async function showInvoice(ctx: any, next: () => Promise<any>) {
  const {
    clients: { smartbill },
  } = ctx

  const { invoiceNumber } = ctx.vtex.route.params
  const smartbillSettings = await smartbill.getSettings()
  const simpleCrypto = new SimpleCrypto(smartbillSettings.smarbillApiToken)
  const toDecrypt = Buffer.from(invoiceNumber, 'base64').toString('ascii')
  let plainNumber = simpleCrypto.decrypt(toDecrypt) as any

  plainNumber =
    typeof plainNumber === 'object' ? plainNumber.number : plainNumber

  const response = await smartbill.showInvoice(plainNumber.toString())

  ctx.status = 200

  ctx.body = response
  ctx.res.setHeader('Content-type', 'application/pdf')

  await next()
}

export async function processChanges(ctx: any, item: any, order: any) {
  if (item?.itemsAdded.length) {
    for (const added of item.itemsAdded) {
      const existingProduct = order?.items?.filter((it: any) => {
        return it.id === added.id
      })

      let imageUrl = ''

      if (!existingProduct.length) {
        // eslint-disable-next-line no-await-in-loop
        const { sku, existingSku } = await getSkuWithVariations(
          added.id.toString(),
          ctx
        )

        if (existingSku.length) {
          imageUrl = existingSku[0].image
        }

        order.items.push(mapItems(sku, added, imageUrl))
      } else {
        const index = order?.items?.indexOf(existingProduct[0])

        if (index !== -1) {
          order.items[index].quantity += added.quantity
        }
      }
    }
  }

  if (item?.itemsRemoved?.length) {
    removeItems(item.itemsRemoved, order)
  }
}

export async function saveInvoice(ctx: Context, next: () => Promise<any>) {
  const {
    clients: { oms, smartbill },
    vtex: { logger },
  } = ctx

  const { corporateAddress, city, county }: AddressForm = await json(ctx.req)

  const { orderId } = ctx.vtex.route.params

  let order: any

  try {
    order = await oms.getOrderId(orderId as string)
  } catch (e) {
    logger?.error({
      message: 'SAVE-INVOICE-ERROR',
      error: formatError(e),
      orderId,
    })
    ctx.status = 500
    ctx.body = formatError(e)

    return
  }

  if (order?.status === 'invoiced') {
    logger.info({
      message: 'Order already invoiced',
      order,
      orderId,
    })
    ctx.status = 304
    ctx.body = 'Order already invoiced'

    return
  }

  if (order?.changesAttachment) {
    for (const item of order?.changesAttachment?.changesData) {
      // eslint-disable-next-line no-await-in-loop
      await processChanges(ctx, item, order)
    }
  }

  const shippingTotal = order?.shippingData?.logisticsInfo?.reduce(
    (acc: number, item: { listPrice: number }) => {
      return acc + item.listPrice / settings.constants.price_multiplier
    },
    0
  )

  order = {
    ...order,
    shippingTotal,
    items: order.items.map((item: any) => {
      return {
        ...item,
        listPrice:
          (item.listPrice + item.tax) / settings.constants.price_multiplier,
        discount:
          (item.listPrice - item.price + item.tax) /
          settings.constants.price_multiplier,
      }
    }),
  }
  let number: string
  let encryptedNumber: string

  try {
    const responseEncryptedNumber = await smartbill.getEncryptedNumber(
      { order },
      { corporateAddress, city, county }
    )

    number = responseEncryptedNumber?.number
    encryptedNumber = responseEncryptedNumber?.encryptedNumber
  } catch (e) {
    logger.error({
      middleware: 'GET ENCRYPTED NUMBER',
      error: formatError(e),
      orderId,
    })
    ctx.status = 500
    ctx.body = formatError(e)

    throw new Error(formatError(e))
  }

  const url = `https://${ctx.vtex.account}.myvtex.com/smartbill/show-invoice/${encryptedNumber}`

  const data = {
    invoiceNumber: number,
    invoiceValue: order.value,
    issuanceDate: new Date().toISOString(),
    invoiceUrl: url,
    items: order.items.map((item: any) => {
      return {
        id: item.productId,
        price: item.sellingPrice,
        quantity: item.quantity,
      }
    }),
  }

  try {
    await oms.postInvoice(orderId as string, data)
    ctx.status = 200
    ctx.body = {
      invoiceNumber: number,
      invoiceDate: data.issuanceDate,
      invoiceUrl: data.invoiceUrl,
    }
  } catch (e) {
    logger.error({
      middleware: 'SAVE-INVOICE',
      error: formatError(e),
      orderId,
    })
    ctx.status = 500
    ctx.body = formatError(e)

    return
  }

  await next()
}

export async function removeItems(itemsToRemove: any, order: any) {
  for (const removed of itemsToRemove) {
    const existingRemovedProduct = order?.items?.filter((it: any) => {
      return it.id === removed.id
    })

    if (existingRemovedProduct.length) {
      if (existingRemovedProduct[0].quantity - removed.quantity === 0) {
        const index = order?.items?.indexOf(existingRemovedProduct[0])

        if (index !== -1) {
          order?.items.splice(index, 1)
        }
      }
    }
  }
}
